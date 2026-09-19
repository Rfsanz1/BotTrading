FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl wget \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/exchange/package.json packages/exchange/package.json
COPY packages/tradingview/package.json packages/tradingview/package.json
COPY scripts/package.json scripts/package.json

RUN npm install -g pnpm@12.4.2 \
  && pnpm install --frozen-lockfile

COPY apps/api apps/api
COPY packages/database packages/database
COPY packages/exchange packages/exchange
COPY packages/tradingview packages/tradingview
COPY scripts scripts

RUN mkdir -p node_modules/@rfsanz \
  && ln -sfn ../../packages/database node_modules/@rfsanz/database \
  && ln -sfn ../../packages/exchange node_modules/@rfsanz/exchange \
  && ln -sfn ../../packages/tradingview node_modules/@rfsanz/tradingview

RUN pnpm --dir packages/database prisma:generate \
  && pnpm --dir packages/database run build

RUN pnpm --dir packages/exchange run build \
  && pnpm --dir packages/tradingview run build \
  && pnpm --dir apps/api run build

WORKDIR /workspace/apps/api
ENV NODE_ENV=production
EXPOSE 3001

CMD ["node", "dist/main.js"]
