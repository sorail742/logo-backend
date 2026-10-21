import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../../common/auth-user';
import { ClientIp, CurrentUser, Roles } from '../../common/decorators';
import {
  AdjustCreditsDto,
  AdminListUsersDto,
  AdminUpdateUserDto,
  AuditQueryDto,
  BlockedTermDto,
} from './admin.dto';
import { AdminService } from './admin.service';

/** Back-office (§9, §13.9). Toutes les routes exigent un rôle interne et une session 2FA. */
@ApiTags('admin')
@ApiBearerAuth()
@Roles('SUPPORT')
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('stats')
  stats() {
    return this.admin.stats();
  }

  @Get('users')
  users(@Query() q: AdminListUsersDto) {
    return this.admin.listUsers(q);
  }

  @Get('users/:uid')
  user(@Param('uid', ParseUUIDPipe) uid: string) {
    return this.admin.getUser(uid);
  }

  @Patch('users/:uid')
  updateUser(
    @CurrentUser() actor: AuthUser,
    @Param('uid', ParseUUIDPipe) uid: string,
    @Body() dto: AdminUpdateUserDto,
    @ClientIp() ip: string,
  ) {
    return this.admin.updateUser(actor, uid, dto, ip);
  }

  @Post('credits/adjust')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.OK)
  adjust(@CurrentUser() actor: AuthUser, @Body() dto: AdjustCreditsDto, @ClientIp() ip: string) {
    return this.admin.adjustCredits(actor, dto, ip);
  }

  @Get('blocked-terms')
  @Roles('ADMIN')
  blockedTerms() {
    return this.admin.blockedTerms();
  }

  @Post('blocked-terms')
  @Roles('ADMIN')
  addBlockedTerm(
    @CurrentUser() actor: AuthUser,
    @Body() dto: BlockedTermDto,
    @ClientIp() ip: string,
  ) {
    return this.admin.addBlockedTerm(actor, dto, ip);
  }

  @Delete('blocked-terms/:id')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeBlockedTerm(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ClientIp() ip: string,
  ) {
    return this.admin.removeBlockedTerm(actor, id, ip);
  }

  @Get('audit-logs')
  @Roles('SUPER_ADMIN')
  auditLogs(@Query() q: AuditQueryDto) {
    return this.admin.auditLogs(q);
  }
}
