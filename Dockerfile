# nnplayer 构建环境
#
# 本 Dockerfile 提供跨平台一致的 Linux 构建环境，用于在 CI 或本地编译 .deb / AppImage。
# Tauri 是桌面框架，产物是原生二进制而非容器，因此镜像仅用于构建阶段。
#
# 构建 commands:
#   docker build -t nnplayer-build .
#   docker run --rm -v "$(pwd):/src" nnplayer-build
#
# 产物在 src-tauri/target/release/bundle/ 下。

FROM docker.m.daocloud.io/library/rust:slim-bookworm AS builder

# ---- Tauri v2 wry Linux 系统依赖 ----
RUN sed -i 's/deb.debian.org/mirrors.tuna.tsinghua.edu.cn/g' /etc/apt/sources.list.d/debian.sources \
    && apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    wget \
    file \
    pkg-config \
    libssl-dev \
    libgtk-3-dev \
    libayatana-appindicator3-dev \
    librsvg2-dev \
    libjavascriptcoregtk-4.1-dev \
    libsoup-3.0-dev \
    libwebkit2gtk-4.1-dev \
    && rm -rf /var/lib/apt/lists/*

# ---- Node.js 22 LTS（从 npm 镜像站直接拉二进制，绕开 nodesource） ----
RUN curl -fsSL https://registry.npmmirror.com/-/binary/node/latest-v22.x/node-v22.20.0-linux-x64.tar.xz \
       -o /tmp/node.tar.xz \
    && tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 \
    && rm /tmp/node.tar.xz \
    && npm config set registry https://registry.npmmirror.com

# ---- Rust 目标与缓存 ----
RUN rustup target add x86_64-unknown-linux-gnu
# cargo 国内镜像（否则 crates.io 连不上）
RUN mkdir -p /usr/local/cargo/registry \
    && printf '[source.crates-io]\nreplace-with = "ustc"\n\n[source.ustc]\nregistry = "sparse+https://mirrors.ustc.edu.cn/crates.io-index/"\n' \
       > /usr/local/cargo/config.toml

WORKDIR /src

# ---- 先装 npm 依赖（层缓存） ----
COPY package.json package-lock.json ./
RUN npm ci

# ---- 源码入镜像 ----
COPY . .

# ---- 编译前端 + Tauri ----
RUN npm run build \
    && cd src-tauri \
    && cargo build --release

# 产物路径（宿主机挂载时可直接取用）：
#   二进制:  src-tauri/target/release/nnplayer
#   安装包:  src-tauri/target/release/bundle/
