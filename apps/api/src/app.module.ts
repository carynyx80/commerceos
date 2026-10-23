import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { AuthGuard } from "./common/auth";
import { AuthController } from "./modules/auth/auth.controller";
import { CatalogController } from "./modules/catalog/catalog.controller";
import { CatalogService } from "./modules/catalog/catalog.service";
import { CartController } from "./modules/cart/cart.controller";
import { MerchantController } from "./modules/merchant/merchant.controller";
import { NotificationsController } from "./modules/notifications/notifications.controller";
import { OrdersController } from "./modules/orders/orders.controller";
import { HealthController } from "./modules/health/health.controller";

@Module({
  imports: [ThrottlerModule.forRoot([{ name: "default", ttl: 60_000, limit: 300 }])],
  controllers: [AuthController, CatalogController, CartController, MerchantController, NotificationsController, OrdersController, HealthController],
  providers: [CatalogService, { provide: APP_GUARD, useClass: ThrottlerGuard }, { provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
