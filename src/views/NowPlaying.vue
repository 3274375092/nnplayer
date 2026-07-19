<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from "vue";
import { useRouter } from "vue-router";
import { Music2, X } from "lucide-vue-next";
import LyricPanel from "@/components/LyricPanel.vue";
import { usePlayerStore } from "@/stores/player";
import { coverImageUrl } from "@/utils/coverImage";

const player = usePlayerStore();
const router = useRouter();
const currentCover = computed(() =>
  coverImageUrl(player.currentSong?.picUrl, 400),
);
const blurredBackgroundCover = computed(() =>
  coverImageUrl(player.currentSong?.picUrl, 128),
);

function close() {
  void router.back();
}

function onKey(e: KeyboardEvent) {
  if (e.key === "Escape") {
    e.preventDefault();
    close();
  }
}

onMounted(() => {
  window.addEventListener("keydown", onKey);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKey);
});
</script>

<template>
  <section class="now-playing" aria-label="正在播放">
    <div
      v-if="player.currentSong?.picUrl"
      class="now-playing__ambient"
      aria-hidden="true"
    >
      <img
        :src="blurredBackgroundCover"
        class="now-playing__ambient-image"
        alt=""
        loading="eager"
        decoding="async"
        fetchpriority="low"
      />
      <div class="now-playing__veil" />
    </div>

    <header class="now-playing__header">
      <div class="now-playing__eyebrow">
        <span class="now-playing__status-dot" aria-hidden="true" />
        <span>正在播放</span>
      </div>
      <button
        type="button"
        class="now-playing__close"
        aria-label="关闭正在播放"
        @click="close"
      >
        <X :size="18" :stroke-width="1.75" />
      </button>
    </header>

    <section class="now-playing__content" aria-label="当前歌曲">
      <div class="now-playing__artwork-wrap">
        <div
          v-if="player.currentSong?.picUrl"
          class="now-playing__artwork-glow"
          :class="{ 'is-playing': player.audioState.playing }"
          aria-hidden="true"
        />
        <div class="now-playing__artwork">
          <img
            v-if="player.currentSong?.picUrl"
            :src="currentCover"
            class="now-playing__cover"
            :alt="`${player.currentSong.name} 专辑封面`"
            loading="eager"
            decoding="async"
            fetchpriority="high"
          />
          <Music2
            v-else
            :size="72"
            :stroke-width="1.25"
            class="now-playing__placeholder"
          />
        </div>
      </div>

      <div class="now-playing__details">
        <div class="now-playing__metadata">
          <h1 class="now-playing__title">
            {{ player.currentSong?.name ?? "尚未播放" }}
          </h1>
          <p class="now-playing__artist">
            {{ player.currentSong?.artists ?? "—" }}
            <span v-if="player.currentSong?.album" class="now-playing__separator">·</span>
            <span v-if="player.currentSong?.album">{{ player.currentSong.album }}</span>
          </p>
        </div>

        <div class="now-playing__lyrics">
          <LyricPanel :panel-height="360" :line-height="40" />
        </div>
      </div>
    </section>
  </section>
</template>

<style scoped>
.now-playing {
  position: relative;
  isolation: isolate;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  min-width: 0;
  overflow-x: hidden;
  overflow-y: auto;
  container-name: now-playing;
  container-type: inline-size;
  background:
    radial-gradient(
      ellipse 58% 48% at 18% 34%,
      color-mix(in srgb, var(--color-ambient-primary) 11%, transparent),
      transparent 70%
    ),
    radial-gradient(
      ellipse 54% 52% at 88% 72%,
      color-mix(in srgb, var(--color-ambient-secondary) 9%, transparent),
      transparent 72%
    ),
    linear-gradient(145deg, var(--color-bg-from), var(--color-bg) 46%, var(--color-bg-to));
  background-color: var(--color-bg);
}

.now-playing::after {
  content: "";
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none;
  background:
    linear-gradient(
      90deg,
      color-mix(in srgb, var(--color-surface-soft, var(--color-card)) 44%, transparent),
      transparent 36%,
      color-mix(in srgb, var(--color-surface-strong, var(--color-card)) 28%, transparent)
    ),
    radial-gradient(
      circle at 50% 0%,
      color-mix(in srgb, var(--color-highlight, var(--color-border)) 52%, transparent),
      transparent 44%
    );
}

.now-playing__ambient {
  position: absolute;
  inset: 0;
  z-index: 0;
  overflow: hidden;
}

.now-playing__ambient-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0.24;
  filter: blur(60px) saturate(0.72) brightness(1.18) contrast(0.78);
  transform: scale(1.14);
}

.now-playing__veil {
  position: absolute;
  inset: 0;
  background:
    linear-gradient(
      to bottom,
      color-mix(in srgb, var(--color-bg-from) 64%, transparent),
      color-mix(in srgb, var(--color-bg) 76%, transparent) 58%,
      color-mix(in srgb, var(--color-bg-to) 92%, transparent)
    ),
    radial-gradient(
      circle at 25% 46%,
      transparent,
      color-mix(in srgb, var(--color-surface-soft, var(--color-card)) 54%, transparent) 68%
    );
}

.now-playing__header {
  position: relative;
  z-index: 3;
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 1.35rem clamp(1.25rem, 3vw, 2.25rem) 0.75rem;
}

.now-playing__eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 0.65rem;
  color: var(--color-text-secondary);
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.14em;
}

.now-playing__status-dot {
  width: 0.4rem;
  height: 0.4rem;
  border-radius: 999px;
  background: var(--color-accent);
  box-shadow: 0 0 12px var(--color-glow);
}

.now-playing__close {
  display: grid;
  width: 2.5rem;
  height: 2.5rem;
  place-items: center;
  border: 1px solid var(--color-border);
  border-radius: 0.8rem;
  color: var(--color-text-secondary);
  background: var(--color-glass, var(--color-card));
  box-shadow: inset 0 1px 0 var(--color-highlight, var(--color-border));
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  transition:
    color 180ms ease,
    background-color 180ms ease,
    border-color 180ms ease,
    transform 180ms ease;
}

.now-playing__close:hover {
  border-color: var(--color-border-strong);
  color: var(--color-text-primary);
  background: var(--color-surface-strong, var(--color-card-hover));
}

.now-playing__close:active {
  transform: scale(0.96);
}

.now-playing__close:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 3px;
}

.now-playing__content {
  position: relative;
  z-index: 2;
  display: grid;
  grid-template-columns: minmax(14rem, 0.92fr) minmax(20rem, 1.08fr);
  align-items: center;
  flex: 1;
  min-height: 0;
  width: min(100%, 74rem);
  margin: 0 auto;
  padding: clamp(0.5rem, 2vh, 1.25rem) clamp(1.4rem, 5vw, 4rem) 5.75rem;
  gap: clamp(3rem, 8vw, 7rem);
}

.now-playing__artwork-wrap {
  position: relative;
  justify-self: end;
  width: clamp(15rem, min(36vw, 52vh), 24rem);
  max-width: 100%;
  aspect-ratio: 1;
}

.now-playing__artwork-glow {
  position: absolute;
  inset: 3%;
  border-radius: 2rem;
  opacity: 0.22;
  background: linear-gradient(
    135deg,
    var(--color-ambient-primary),
    var(--color-ambient-secondary)
  );
  filter: blur(32px) saturate(0.8);
  transform: translateY(5%) scale(0.93);
  transition: opacity 500ms ease;
}

.now-playing__artwork-glow.is-playing {
  opacity: 0.36;
}

.now-playing__artwork {
  position: relative;
  display: grid;
  width: 100%;
  height: 100%;
  place-items: center;
  overflow: hidden;
  border: 1px solid var(--color-border-strong);
  border-radius: clamp(1.25rem, 2.5vw, 1.75rem);
  background: var(--color-surface-soft, var(--color-card));
  box-shadow:
    0 32px 70px rgba(0, 0, 0, 0.42),
    0 8px 24px color-mix(in srgb, var(--color-shadow) 62%, transparent),
    inset 0 1px 0 var(--color-highlight, var(--color-border));
}

.now-playing__artwork::after {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  border-radius: inherit;
  box-shadow: inset 0 0 0 1px color-mix(
    in srgb,
    var(--color-highlight, var(--color-border)) 58%,
    transparent
  );
}

.now-playing__cover {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.now-playing__placeholder {
  color: var(--color-text-tertiary);
}

.now-playing__details {
  display: flex;
  min-width: 0;
  max-width: 33rem;
  flex-direction: column;
  gap: 1.25rem;
}

.now-playing__metadata {
  min-width: 0;
  padding-left: 0.2rem;
}

.now-playing__title {
  display: -webkit-box;
  overflow: hidden;
  margin: 0 0 0.45rem;
  /* Windows WebView 在紧行高 + line-clamp 下会裁掉 g/y 等字形的下伸部。 */
  padding-bottom: 0.1em;
  color: var(--color-text-primary);
  font-size: clamp(2rem, 3.4vw, 3.15rem);
  font-weight: 650;
  letter-spacing: -0.04em;
  line-height: 1.12;
  text-wrap: balance;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.now-playing__artist {
  overflow: hidden;
  margin: 0;
  color: var(--color-text-secondary);
  font-size: 0.95rem;
  font-weight: 450;
  line-height: 1.5;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.now-playing__separator {
  margin: 0 0.5rem;
  color: var(--color-text-secondary);
}

.now-playing__lyrics :deep(.lyric-panel) {
  border-color: var(--color-border);
  background:
    radial-gradient(
      circle at 12% -12%,
      color-mix(in srgb, var(--color-accent) 9%, transparent),
      transparent 42%
    ),
    linear-gradient(
      145deg,
      color-mix(in srgb, var(--color-highlight, var(--color-border)) 42%, transparent),
      color-mix(in srgb, var(--color-surface-soft, var(--color-card)) 88%, transparent)
    );
  background-color: var(--color-glass, var(--color-card));
  box-shadow:
    inset 0 1px 0 var(--color-highlight, var(--color-border)),
    0 20px 56px color-mix(in srgb, var(--color-shadow) 38%, transparent);
}

@media (max-height: 700px) and (min-width: 821px) {
  .now-playing__header {
    padding-top: 1rem;
  }

  .now-playing__content {
    padding-top: 0.25rem;
    gap: clamp(2rem, 6vw, 4.5rem);
  }

  .now-playing__artwork-wrap {
    width: clamp(14rem, min(34vw, 47vh), 19rem);
  }

  .now-playing__details {
    gap: 0.85rem;
  }
}

@container now-playing (max-width: 52rem) {
  .now-playing__content {
    grid-template-columns: minmax(11rem, 0.8fr) minmax(17rem, 1.2fr);
    padding-inline: 1.5rem;
    gap: 2rem;
  }

  .now-playing__artwork-wrap {
    width: clamp(11rem, 28cqw, 14rem);
  }

  .now-playing__details {
    gap: 0.85rem;
  }

  .now-playing__title {
    font-size: clamp(1.65rem, 4cqw, 2.35rem);
  }
}

@container now-playing (max-width: 38rem) {
  .now-playing__content {
    grid-template-columns: 1fr;
    align-content: start;
    justify-items: center;
    padding-top: 1rem;
    gap: 2rem;
  }

  .now-playing__artwork-wrap {
    justify-self: center;
    width: min(65vw, 17rem);
  }

  .now-playing__details {
    width: min(100%, 34rem);
  }
}

@media (prefers-reduced-motion: reduce) {
  .now-playing__artwork-glow,
  .now-playing__close {
    transition: none;
  }
}
</style>
