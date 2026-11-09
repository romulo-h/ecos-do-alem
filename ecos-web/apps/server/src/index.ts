import { startServer } from "./app";

const port = Number(process.env.PORT ?? 2567);

startServer(port).then((s) => {
  console.log(`Ecos do Além no ar: http://localhost:${s.port}`);
  // o Coolify para o contêiner com SIGTERM a cada deploy: fecha as conexões e sai sem esperar o timeout
  const stop = () => void s.close().then(() => process.exit(0));
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
});
