import { Controller, Get, Param, Post, Query, Req } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";

import { NotificationType } from "../../database/schemas/notification.schema";
import { NotificationsService } from "./notifications.service";

@ApiTags("notifications")
@Controller("notifications")
export class NotificationsController {
  constructor(private notifications: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: "This account's notifications, newest first, filterable" })
  list(
    @Query("unread") unread: string | undefined,
    @Query("type") type: string | undefined,
    @Query("q") q: string | undefined,
    @Query("page") page: string | undefined,
    @Query("limit") limit: string | undefined,
    @Req() req: any,
  ) {
    return this.notifications.list(req.user.id, {
      unreadOnly: unread === "true",
      type: type as NotificationType | undefined,
      q,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get("unread-count")
  @ApiOperation({ summary: "How many notifications are unread" })
  async unreadCount(@Req() req: any) {
    return { count: await this.notifications.unreadCount(req.user.id) };
  }

  @Post("read-all")
  @ApiOperation({ summary: "Mark every notification read" })
  readAll(@Req() req: any) {
    return this.notifications.markAllRead(req.user.id);
  }

  @Post(":id/read")
  @ApiOperation({ summary: "Mark one notification read" })
  read(@Param("id") id: string, @Req() req: any) {
    return this.notifications.markRead(id, req.user.id);
  }
}
