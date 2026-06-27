use std::fs::File;
use std::num::NonZero;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex, RwLock};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use rodio::source::Source;
use rodio::stream::{DeviceSinkBuilder, MixerDeviceSink};
use rodio::Player;
use symphonia::core::codecs::audio::{AudioDecoder, AudioDecoderOptions};
use symphonia::core::errors::Error as SymphError;
use symphonia::core::formats::probe::Hint;
use symphonia::core::formats::{FormatOptions, FormatReader, SeekMode, SeekTo};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::units::Time;
use tauri::Emitter;

use crate::audio::state::{AudioStateSnapshot, InternalState};

// ============================================================
// SymphoniaSource — 实现 rodio::Source，用 symphonia 解码
// ============================================================

pub struct SymphoniaSource {
    format: Box<dyn FormatReader>,
    decoder: Box<dyn AudioDecoder>,
    track_id: u32,

    sample_buf: Vec<f32>,
    sample_pos: usize,

    sample_rate: NonZero<u32>,
    channels: NonZero<u16>,
    total_samples: u64,
    duration: f64,

    state: Arc<RwLock<InternalState>>,
    update_interval: u64,
    first_sample: bool,

    eof_tx: Option<Sender<()>>,
}

impl SymphoniaSource {
    pub fn open_probed(
        path: &str,
        state: Arc<RwLock<InternalState>>,
        eof_tx: Option<Sender<()>>,
        start_time: f64,
    ) -> Result<Self, String> {
        let file = File::open(path).map_err(|e| format!("打开文件失败: {e}"))?;
        let mss = MediaSourceStream::new(Box::new(file), Default::default());

        let mut hint = Hint::new();
        if let Some(ext) = std::path::Path::new(path)
            .extension()
            .and_then(|e| e.to_str())
        {
            hint.with_extension(ext);
        }

        let mut format = symphonia::default::get_probe()
            .probe(
                &hint,
                mss,
                FormatOptions::default(),
                MetadataOptions::default(),
            )
            .map_err(|e| format!("解析音频格式失败: {e}"))?;

        let track = format
            .tracks()
            .iter()
            .find(|t| t.codec_params.as_ref().is_some_and(|p| p.is_audio()))
            .cloned()
            .ok_or_else(|| "未找到音频轨道".to_string())?;

        let codec_params = track
            .codec_params
            .as_ref()
            .ok_or_else(|| "无音频参数".to_string())?;
        let audio_params = codec_params
            .audio()
            .ok_or_else(|| "非音频轨道".to_string())?;

        let codecs = symphonia::default::get_codecs();
        let decoder = codecs
            .make_audio_decoder(audio_params, &AudioDecoderOptions::default())
            .map_err(|e| format!("创建解码器失败: {e}"))?;

        let sample_rate_val = audio_params.sample_rate.unwrap_or(44100);
        let sample_rate = NonZero::new(sample_rate_val.max(1)).unwrap_or(NonZero::new(44100).unwrap());
        let ch_count = audio_params.channels.as_ref().map(|c| c.count() as u16).unwrap_or(2);
        let channels = NonZero::new(ch_count.max(1)).unwrap_or(NonZero::new(2).unwrap());

        // duration：从 media_info 拿 time_base + duration
        let duration = {
            let media_info = format.media_info();
            match (media_info.time_base, media_info.duration) {
                (Some(tb), Some(dur)) => dur.get() as f64 * f64::from(tb),
                _ => 0.0,
            }
        };

        if start_time > 0.0 {
            if let Some(target) = Time::try_from_secs_f64(start_time) {
                let _ = format.seek(SeekMode::Accurate, SeekTo::Time {
                    time: target,
                    track_id: Some(track.id),
                });
            }
        }

        let initial_samples = if start_time > 0.0 {
            (start_time * sample_rate.get() as f64 * ch_count as f64) as u64
        } else {
            0
        };

        log::info!(
            "[audio] SymphoniaSource opened: duration={}s sr={} ch={} start={}",
            duration, sample_rate_val, ch_count, start_time
        );

        Ok(Self {
            format,
            decoder,
            track_id: track.id,
            sample_buf: Vec::new(),
            sample_pos: 0,
            sample_rate,
            channels,
            total_samples: initial_samples,
            duration,
            state,
            update_interval: sample_rate.get() as u64 / 5,
            first_sample: true,
            eof_tx,
        })
    }

    fn decode_next(&mut self) -> bool {
        self.sample_buf.clear();
        self.sample_pos = 0;

        loop {
            let packet = match self.format.next_packet() {
                Ok(Some(pkt)) => pkt,
                Ok(None) => {
                    log::info!("[audio] format.next_packet: None (EOF)");
                    return false;
                }
                Err(SymphError::DecodeError(e)) => {
                    log::warn!("[audio] format decode error: {e}");
                    continue;
                }
                Err(e) => {
                    log::warn!("[audio] format error: {e:?}");
                    return false;
                }
            };

            if packet.track_id != self.track_id {
                continue;
            }

            match self.decoder.decode(&packet) {
                Ok(decoded) => {
                    decoded.copy_to_vec_interleaved(&mut self.sample_buf);
                    return true;
                }
                Err(SymphError::DecodeError(e)) => {
                    log::warn!("[audio] decoder error: {e}");
                    continue;
                }
                Err(e) => {
                    log::warn!("[audio] decoder error: {e:?}");
                    return false;
                }
            }
        }
    }
}

impl Iterator for SymphoniaSource {
    type Item = f32;

    fn next(&mut self) -> Option<f32> {
        if self.sample_pos >= self.sample_buf.len() {
            if !self.decode_next() {
                if let Some(tx) = self.eof_tx.take() {
                    let _ = tx.send(());
                }
                return None;
            }
        }

        let s = self.sample_buf[self.sample_pos];
        self.sample_pos += 1;
        self.total_samples += 1;

        if self.first_sample {
            log::info!("[audio] source first sample output, total_samples={}", self.total_samples);
            self.first_sample = false;
        }

        if self.total_samples % self.update_interval == 0 {
            if let Ok(mut st) = self.state.write() {
                st.current_time = self.total_samples as f64
                    / (self.sample_rate.get() as f64 * self.channels.get() as f64);
            }
        }

        Some(s)
    }
}

impl Source for SymphoniaSource {
    fn current_span_len(&self) -> Option<usize> {
        None
    }

    fn channels(&self) -> NonZero<u16> {
        self.channels
    }

    fn sample_rate(&self) -> NonZero<u32> {
        self.sample_rate
    }

    fn total_duration(&self) -> Option<Duration> {
        if self.duration > 0.0 {
            Some(Duration::from_secs_f64(self.duration))
        } else {
            None
        }
    }
}

// ============================================================
// AudioEngine — 统一播放控制
// ============================================================

pub struct AudioEngine {
    _sink: MixerDeviceSink,
    // Player 通过 Arc<Mutex<>> 共享，eof_monitor 也能读
    player_slot: Arc<Mutex<Option<Player>>>,
    state: Arc<RwLock<InternalState>>,
    eof_monitor: Option<JoinHandle<()>>,
    is_paused: Arc<AtomicBool>,
    app_handle: Option<tauri::AppHandle>,
}

impl AudioEngine {
    pub fn new() -> Result<Self, String> {
        let sink = DeviceSinkBuilder::open_default_sink()
            .map_err(|e| format!("打开音频设备失败: {e}"))?;

        let state = Arc::new(RwLock::new(InternalState::default()));

        Ok(Self {
            _sink: sink,
            player_slot: Arc::new(Mutex::new(None)),
            state,
            eof_monitor: None,
            is_paused: Arc::new(AtomicBool::new(false)),
            app_handle: None,
        })
    }

    pub fn set_app_handle(&mut self, handle: tauri::AppHandle) {
        self.app_handle = Some(handle);
    }

    pub fn play(&mut self, path: &str, start_time: f64) -> Result<(), String> {
        log::info!("[audio] play: path={path} start={start_time}");
        self.stop_inner();

        let state = Arc::clone(&self.state);
        let (eof_tx, eof_rx) = mpsc::channel();

        let source = SymphoniaSource::open_probed(path, Arc::clone(&state), Some(eof_tx), start_time)?;
        let duration = source.duration;
        log::info!("[audio] opened: duration={duration}");

        {
            let mut st = state.write().map_err(|e| e.to_string())?;
            st.playing = true;
            st.path = Some(path.to_string());
            st.duration = duration;
            st.current_time = start_time;
            // 时钟起点：从 start_time 开始算
            st.play_offset = start_time;
            st.play_started_at = Some(Instant::now());
        }

        let player = Player::connect_new(self._sink.mixer());
        let vol = state
            .read()
            .map(|s| s.volume as f32)
            .unwrap_or(0.8);
        player.set_volume(vol);
        player.append(source);
        player.play();
        log::info!("[audio] player created, append+play done, volume={vol}");

        // 存到共享 slot
        *self.player_slot.lock().map_err(|e| e.to_string())? = Some(player);

        // 启动 eof_monitor
        self.is_paused.store(false, Ordering::SeqCst);
        let app = self.app_handle.clone();
        let state_clone = Arc::clone(&state);
        self.eof_monitor = Some(thread::spawn(move || {
            log::info!("[audio] eof_monitor started");
            let mut tick_n = 0u32;
            loop {
                match eof_rx.recv_timeout(Duration::from_millis(40)) {
                    Ok(()) => {
                        log::info!("[audio] EOF received");
                        if let Ok(mut st) = state_clone.write() {
                            st.playing = false;
                        }
                        if let Some(ref app) = app {
                            let _ = app.emit("audio:ended", ());
                        }
                        return;
                    }
                    Err(mpsc::RecvTimeoutError::Timeout) => {
                        // 用 system clock 计算 position
                        if let Ok(mut st) = state_clone.write() {
                            if let Some(start) = st.play_started_at {
                                st.current_time = st.play_offset
                                    + Instant::now().saturating_duration_since(start).as_secs_f64();
                            }
                        }
                        if let Some(ref app) = app {
                            let snap = AudioStateSnapshot::from(&*state_clone);
                            let _ = app.emit("audio:tick", &snap);
                        }
                        tick_n += 1;
                        if tick_n % 5 == 1 {
                            log::info!(
                                "[audio] tick #{} t={:.2}s dur={:.2}s playing={} app={}",
                                tick_n,
                                state_clone.read().map(|s| s.current_time).unwrap_or(0.0),
                                state_clone.read().map(|s| s.duration).unwrap_or(0.0),
                                state_clone.read().map(|s| s.playing).unwrap_or(false),
                                app.is_some()
                            );
                        }
                    }
                    Err(mpsc::RecvTimeoutError::Disconnected) => {
                        log::info!("[audio] eof_monitor disconnected");
                        return;
                    }
                }
            }
        }));

        Ok(())
    }

    pub fn pause(&mut self) {
        if let Ok(slot) = self.player_slot.lock() {
            if let Some(p) = slot.as_ref() {
                p.pause();
            }
        }
        self.freeze_clock();
        self.is_paused.store(true, Ordering::SeqCst);
        self.emit_tick();
    }

    pub fn resume(&mut self) {
        if let Ok(slot) = self.player_slot.lock() {
            if let Some(p) = slot.as_ref() {
                p.play();
            }
        }
        self.restart_clock();
        self.is_paused.store(false, Ordering::SeqCst);
        self.emit_tick();
    }

    pub fn toggle(&mut self) {
        let should_pause = {
            let slot = self.player_slot.lock();
            match slot {
                Ok(slot) => slot
                    .as_ref()
                    .map(|p| !p.is_paused())
                    .unwrap_or(false),
                Err(_) => false,
            }
        };
        if should_pause {
            if let Ok(slot) = self.player_slot.lock() {
                if let Some(p) = slot.as_ref() {
                    p.pause();
                }
            }
            self.freeze_clock();
            self.is_paused.store(true, Ordering::SeqCst);
        } else {
            if let Ok(slot) = self.player_slot.lock() {
                if let Some(p) = slot.as_ref() {
                    p.play();
                }
            }
            self.restart_clock();
            self.is_paused.store(false, Ordering::SeqCst);
        }
        self.emit_tick();
    }

    /// 暂停时把已播时间累加到 play_offset，并清掉时钟起点（停止计时）
    fn freeze_clock(&self) {
        if let Ok(mut st) = self.state.write() {
            if let Some(start) = st.play_started_at.take() {
                st.play_offset += start.elapsed().as_secs_f64();
                st.current_time = st.play_offset;
            }
            st.playing = false;
        }
    }

    /// 恢复时重启时钟起点
    fn restart_clock(&self) {
        if let Ok(mut st) = self.state.write() {
            st.play_started_at = Some(Instant::now());
            st.playing = true;
        }
    }

    /// 立刻向前端推送一次 audio:tick（seek/暂停/恢复后不用等 eof_monitor 轮询间隔）
    fn emit_tick(&self) {
        let Some(ref app) = self.app_handle else { return };
        let snap = AudioStateSnapshot::from(&*self.state);
        let _ = app.emit("audio:tick", &snap);
    }

    /// Seek — 重新创建 source 替换到 Player。
    /// rodio Player::try_seek 对自定义 source 返回 NotSupported，所以用重建方式。
    pub fn seek(&mut self, time: f64) {
        let time = time.max(0.0);
        let path = self
            .state
            .read()
            .ok()
            .and_then(|s| s.path.clone());
        let Some(path) = path else {
            log::warn!("[audio] seek: no path in state");
            return;
        };
        let was_paused = self.is_paused.load(Ordering::SeqCst);
        log::info!("[audio] seek to {time}s (paused={was_paused})");
        if self.play(&path, time).is_err() {
            return;
        }
        if was_paused {
            // 暂停时 seek：play 会重置时钟为 now + offset=time，但我们要保留 paused 状态
            // 通过再次调 pause 把 play_offset 锁住并清掉 play_started_at
            self.pause();
        }
        self.emit_tick();
    }

    pub fn set_volume(&mut self, volume: f64) {
        let vol = volume.max(0.0).min(1.0);
        if let Ok(mut st) = self.state.write() {
            st.volume = vol;
        }
        if let Ok(slot) = self.player_slot.lock() {
            if let Some(p) = slot.as_ref() {
                p.set_volume(vol as f32);
            }
        }
    }

    fn stop_inner(&mut self) {
        if let Ok(mut slot) = self.player_slot.lock() {
            if let Some(p) = slot.take() {
                p.stop();
            }
        }
        if let Some(h) = self.eof_monitor.take() {
            let _ = h.join();
        }
        if let Ok(mut st) = self.state.write() {
            st.playing = false;
        }
        self.is_paused.store(false, Ordering::SeqCst);
    }

    pub fn snapshot(&self) -> AudioStateSnapshot {
        // 用 system clock 计算 position
        if let Ok(mut st) = self.state.write() {
            if let Some(start) = st.play_started_at {
                st.current_time = st.play_offset
                    + Instant::now().saturating_duration_since(start).as_secs_f64();
            }
        }
        AudioStateSnapshot::from(&*self.state)
    }
}

impl Drop for AudioEngine {
    fn drop(&mut self) {
        self.stop_inner();
    }
}
