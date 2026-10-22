import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../../common/auth-user';
import { CurrentUser } from '../../common/decorators';
import { cursorArgs, CursorPaginationDto, toPage } from '../../common/dto/pagination.dto';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { Notification } from '@prisma/client';

/** Notification (type AppNotification du front) : titre, texte et lien tirés de la charge utile. */
function toNotificationDto({ payload, userId: _userId, ...notification }: Notification) {
  const data = (payload ?? {}) as { title?: string; body?: string; href?: string };
  return { ...notification, title: data.title ?? '', body: data.body ?? '', href: data.href ?? null };
}

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@CurrentUser() user: AuthUser, @Query() q: CursorPaginationDto) {
    const [rows, unread] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId: user.id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...cursorArgs(q),
      }),
      this.prisma.notification.count({ where: { userId: user.id, readAt: null } }),
    ]);
    const page = toPage(rows, q.limit);
    return { ...page, items: page.items.map(toNotificationDto), unread };
  }

  @Patch(':id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  async read(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.prisma.notification.updateMany({
      where: { id, userId: user.id, readAt: null },
      data: { readAt: new Date() },
    });
  }
}
