import { Controller, Get, HttpCode, Post } from "@nestjs/common";
import { prisma } from "../../common/prisma";
import { Auth, CurrentUser, type AuthContext } from "../../common/auth";

@Controller("notifications")
@Auth()
export class NotificationsController {
  @Get()
  async list(@CurrentUser() a: AuthContext) {
    const items = await prisma.notification.findMany({ where: { userId: a.userId }, orderBy: { createdAt: "desc" }, take: 100 });
    return { items };
  }
  @Get("unread-count")
  async unread(@CurrentUser() a: AuthContext) {
    return { unread: await prisma.notification.count({ where: { userId: a.userId, readAt: null } }) };
  }
  @Post("read-all")
  @HttpCode(200)
  async readAll(@CurrentUser() a: AuthContext) {
    await prisma.notification.updateMany({ where: { userId: a.userId, readAt: null }, data: { readAt: new Date() } });
    return { ok: true };
  }
}
