import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import cookieParser from "cookie-parser";
import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { AppModule } from "./app.module";
import { ErrorFilter } from "./common/errors";
import { config } from "./config";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: ["log", "warn", "error"] });
  const log = new Logger("HTTP");
  app.use(cookieParser());
  // Request tracing: honour an incoming id, otherwise mint one; echo it back.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const id = (req.headers["x-request-id"] as string)?.slice(0, 64) || randomUUID();
    req.id = id;
    res.setHeader("x-request-id", id);
    const t = Date.now();
    res.on("finish", () => log.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - t}ms [${id}]`));
    next();
  });
  app.enableCors({ origin: config.appOrigins, credentials: true });
  app.useGlobalFilters(new ErrorFilter());
  app.getHttpAdapter().getInstance().set("trust proxy", 1);
  app.getHttpAdapter().getInstance().disable("x-powered-by");

  const doc = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle("Commerce OS API").setVersion("0.1.0").build());
  SwaggerModule.setup("docs", app, doc);

  await app.listen(config.port, "127.0.0.1");
  log.log(`Commerce OS API on :${config.port} (chain ${config.chainId})`);
}
void bootstrap();
