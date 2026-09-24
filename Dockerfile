FROM node:24-alpine
WORKDIR /app
COPY --chown=node:node package.json README.md ./
COPY --chown=node:node src ./src
COPY --chown=node:node public ./public
COPY --chown=node:node tools ./tools
COPY --chown=node:node docs ./docs
COPY --chown=node:node examples ./examples
COPY --chown=node:node VERIFICATION.md SECURITY.md ./
COPY --chown=node:node demo ./demo
COPY --chown=node:node test ./test
RUN mkdir /app/data && chown node:node /app/data
USER node
ENV CG_HOST=0.0.0.0 CG_PORT=4310
EXPOSE 4310
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s CMD node -e "fetch('http://127.0.0.1:4310/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/server.mjs"]
