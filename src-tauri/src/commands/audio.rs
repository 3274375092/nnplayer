use std::sync::Mutex;

use tauri::State;

use crate::audio::engine::AudioEngine;
use crate::audio::state::AudioStateSnapshot;
use crate::error::{AppError, AppResult};

/// 播放本地音频文件（从指定位置开始）。
#[tauri::command]
pub fn play_local(
    path: String,
    engine: State<'_, Mutex<AudioEngine>>,
) -> AppResult<()> {
    let mut eng = engine.lock().map_err(|e| AppError::Internal(e.to_string()))?;
    eng.play(&path, 0.0)
        .map_err(|e| AppError::Audio(e))
}

/// 暂停播放。
#[tauri::command]
pub fn pause_audio(engine: State<'_, Mutex<AudioEngine>>) -> AppResult<()> {
    let mut eng = engine.lock().map_err(|e| AppError::Internal(e.to_string()))?;
    eng.pause();
    Ok(())
}

/// 继续播放。
#[tauri::command]
pub fn resume_audio(engine: State<'_, Mutex<AudioEngine>>) -> AppResult<()> {
    let mut eng = engine.lock().map_err(|e| AppError::Internal(e.to_string()))?;
    eng.resume();
    Ok(())
}

/// 切换播放/暂停。
#[tauri::command]
pub fn toggle_audio(engine: State<'_, Mutex<AudioEngine>>) -> AppResult<()> {
    let mut eng = engine.lock().map_err(|e| AppError::Internal(e.to_string()))?;
    eng.toggle();
    Ok(())
}

/// 跳转到指定时间（秒）。
#[tauri::command]
pub fn seek_audio(
    seconds: f64,
    engine: State<'_, Mutex<AudioEngine>>,
) -> AppResult<()> {
    let mut eng = engine.lock().map_err(|e| AppError::Internal(e.to_string()))?;
    eng.seek(seconds);
    Ok(())
}

/// 设置音量（0.0 ~ 1.0）。
#[tauri::command]
pub fn set_audio_volume(
    volume: f64,
    engine: State<'_, Mutex<AudioEngine>>,
) -> AppResult<()> {
    let mut eng = engine.lock().map_err(|e| AppError::Internal(e.to_string()))?;
    eng.set_volume(volume);
    Ok(())
}

/// 获取当前播放状态快照。
#[tauri::command]
pub fn get_audio_state(
    engine: State<'_, Mutex<AudioEngine>>,
) -> AppResult<AudioStateSnapshot> {
    let eng = engine.lock().map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(eng.snapshot())
}
