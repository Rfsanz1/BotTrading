FROM node:22-bookworm-slim
WORKDIR /usr/src/app
COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm@12.4.2 && pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build
EXPOSE 3001
CMD ["pnpm", "start"]
