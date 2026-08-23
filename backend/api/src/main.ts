import { Logger, ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";

import { AppModule } from "./app.module";
import { seed } from "./database/seed";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // On an ephemeral instance there is nothing to serve until it is seeded, and
  // the mobile app needs a backend from one command. Against a real MONGODB_URI
  // this does nothing — seeding there is a deliberate `npm run seed`.
  if (!process.env.MONGODB_URI) {
    const logger = new Logger("seed");
    logger.log("no MONGODB_URI — seeding the ephemeral instance");
    const counts = await seed();
    logger.log(
      `seeded ${counts.priceEntries.toLocaleString("en-IN")} prices across ` +
        `${counts.locations} locations`,
    );
  }

  app.setGlobalPrefix("api");
  app.enableCors();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const config = new DocumentBuilder()
    .setTitle("GCPE API")
    .setDescription(
      "GAIL PE competitive pricing. All netback logic lives here; the mobile app renders what this returns.",
    )
    .setVersion("0.1")
    .addBearerAuth()
    .build();
  SwaggerModule.setup("api/docs", app, SwaggerModule.createDocument(app, config));

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  new Logger("bootstrap").log(`GCPE API on http://localhost:${port}/api`);
}

bootstrap();
