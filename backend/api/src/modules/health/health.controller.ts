import { Controller, Get } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";

import { Public } from "../auth/public.decorator";

@ApiTags("health")
@Controller("health")
export class HealthController {
  constructor(@InjectConnection() private connection: Connection) {}

  /**
   * What the host polls to decide this instance is live. It has to be public:
   * a health check cannot carry a token, and a 401 would read as "down" and
   * put the service into a restart loop.
   *
   * It reports the database separately from the process. A booted API that
   * cannot reach Atlas answers every real request with an error, so "the
   * process is up" on its own is not the question worth answering.
   */
  @Public()
  @Get()
  @ApiOperation({ summary: "Liveness probe for the hosting platform" })
  check() {
    // 1 is mongoose's "connected"; anything else means queries will not serve.
    const database = this.connection.readyState === 1 ? "up" : "down";
    return {
      status: database === "up" ? "ok" : "degraded",
      database,
      uptime: Math.round(process.uptime()),
    };
  }
}
