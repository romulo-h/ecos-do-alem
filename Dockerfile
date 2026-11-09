# Ecos do Além (versão web) — imagem para o Coolify, no formato do expediente-caotico.
# Build na raiz do repositório; só a pasta ecos-web entra (o projeto Unity fica de fora pelo .dockerignore).

FROM node:22-alpine AS build
ARG SOURCE_COMMIT=""
ENV SOURCE_COMMIT=$SOURCE_COMMIT
RUN corepack enable
WORKDIR /app
COPY ecos-web/ .
RUN pnpm install --frozen-lockfile && pnpm build

# O servidor é um arquivo só (esbuild) e não tem dependência em produção: basta copiar os dois builds.
FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/apps/server/package.json ./apps/server/package.json
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/web/dist ./apps/web/dist
ENV NODE_ENV=production PORT=2567
EXPOSE 2567
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" || exit 1
CMD ["node", "apps/server/dist/index.js"]
