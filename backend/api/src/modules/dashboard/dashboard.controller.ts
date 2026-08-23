import { Controller, Get } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";

import { DashboardService } from "./dashboard.service";

@ApiTags("dashboard")
@Controller("admin")
export class DashboardController {
  constructor(private dashboard: DashboardService) {}

  @Get("dashboard")
  @ApiOperation({ summary: "KPIs, trend charts, and recent activity for the Admin Panel" })
  get() {
    return this.dashboard.get();
  }
}
