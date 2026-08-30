import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { MongooseModule } from "@nestjs/mongoose";

import { AuditLogModule } from "./modules/audit-log/audit-log.module";
import { CatalogModule } from "./modules/catalog/catalog.module";
import { DashboardModule } from "./modules/dashboard/dashboard.module";
import { JwtAuthGuard } from "./modules/auth/jwt-auth.guard";
import { AuthModule } from "./modules/auth/auth.module";
import { CircularsModule } from "./modules/circulars/circulars.module";
import { CorrectionsModule } from "./modules/corrections/corrections.module";
import { DatasetModule } from "./modules/dataset/dataset.module";
import { DiscountsModule } from "./modules/discounts/discounts.module";
import { ExportsModule } from "./modules/exports/exports.module";
import { PriceCircularsModule } from "./modules/price-circulars/price-circulars.module";
import { ProducersModule } from "./modules/producers/producers.module";
import { DealsModule } from "./modules/deals/deals.module";
import { FreightModule } from "./modules/freight/freight.module";
import { FreightCircularsModule } from "./modules/freight-circulars/freight-circulars.module";
import { GradesModule } from "./modules/grades/grades.module";
import { HealthModule } from "./modules/health/health.module";
import { LocationsModule } from "./modules/locations/locations.module";
import { NotificationsModule } from "./modules/notifications/notifications.module";
import { PricingModule } from "./modules/pricing/pricing.module";
import { TimelineModule } from "./modules/timeline/timeline.module";

@Module({
  imports: [
    AuditLogModule,
    CatalogModule,
    ConfigModule.forRoot({ isGlobal: true }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => {
        const uri = config.get<string>("MONGODB_URI");
        if (uri) return { uri };
        // No Atlas URI: start an ephemeral instance so the API can be run and
        // exercised locally. Still MongoDB — same driver, same queries — it
        // just does not survive the process.
        const { MongoMemoryServer } = await import("mongodb-memory-server");
        const server = await MongoMemoryServer.create();
        return { uri: server.getUri("gcpe") };
      },
    }),
    DatasetModule,
    AuthModule,
    GradesModule,
    PricingModule,
    FreightModule,
    DealsModule,
    CircularsModule,
    LocationsModule,
    NotificationsModule,
    CorrectionsModule,
    DiscountsModule,
    ProducersModule,
    PriceCircularsModule,
    FreightCircularsModule,
    ExportsModule,
    DashboardModule,
    HealthModule,
    TimelineModule,
  ],
  // Authenticated by default. A route opens up only by saying so with @Public().
  providers: [{ provide: APP_GUARD, useClass: JwtAuthGuard }],
})
export class AppModule {}
