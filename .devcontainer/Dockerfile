FROM python:3.12-slim

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    gnupg \
    git \
    bash \
    nodejs \
    npm \
    fonts-liberation \
    fonts-noto-color-emoji \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libatspi2.0-0 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libegl1 \
    libfontconfig1 \
    libfreetype6 \
    libgbm1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libwayland-client0 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    libxshmfence1 \
    xvfb \
  && rm -rf /var/lib/apt/lists/*

RUN install -d -m 0755 /etc/apt/keyrings \
  && curl -fsSL https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /etc/apt/keyrings/google-chrome.gpg \
  && chmod 0644 /etc/apt/keyrings/google-chrome.gpg \
  && echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/google-chrome.gpg] https://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends google-chrome-stable \
  && rm -rf /var/lib/apt/lists/*

RUN PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install -g @openai/codex playwright \
  && playwright install chromium \
  && chmod -R 755 /ms-playwright
RUN mv /usr/local/bin/codex /usr/local/bin/codex-real \
  && printf '%s\n' \
    '#!/usr/bin/env bash' \
    '# Keep Codex aligned with the project-local devcontainer config.' \
    'exec /usr/local/bin/codex-real -c sandbox_mode=\"danger-full-access\" "$@"' \
    > /usr/local/bin/codex \
  && chmod 0755 /usr/local/bin/codex
RUN useradd -m -s /bin/bash codex

USER codex
WORKDIR /workspaces
