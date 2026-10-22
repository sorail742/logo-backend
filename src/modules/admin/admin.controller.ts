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
  CreditRequestDecisionDto,
  ListCreditRequestsDto,
  ReviewSignatureDto,
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

  /** Suspension, 2FA et rôle : admin au moins (le rôle, super admin), sur un rang inférieur. */
  @Patch('users/:uid')
  @Roles('ADMIN')
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

  /** Le support propose un ajustement ; un admin le valide ou le refuse (§3). */
  @Post('credits/requests')
  requestCredits(@CurrentUser() actor: AuthUser, @Body() dto: AdjustCreditsDto, @ClientIp() ip: string) {
    return this.admin.requestCreditAdjustment(actor, dto, ip);
  }

  @Get('credits/requests')
  creditRequests(@Query() q: ListCreditRequestsDto) {
    return this.admin.creditRequests(q);
  }

  @Patch('credits/requests/:id')
  @Roles('ADMIN')
  decideCredits(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreditRequestDecisionDto,
    @ClientIp() ip: string,
  ) {
    return this.admin.decideCreditRequest(actor, id, dto, ip);
  }

  @Get('blocked-terms')
  @Roles('ADMIN')
  blockedTerms() {
    return this.admin.blockedTerms();
  }

  @Post('blocked-terms')
  @Roles('ADMIN')
  addBlockedTerm(@CurrentUser() actor: AuthUser, @Body() dto: BlockedTermDto, @ClientIp() ip: string) {
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

  // ─── Modération (§6.4, ADM-11) ───

  @Get('moderation')
  moderation() {
    return this.admin.moderationQueue();
  }

  /** Modération d'un contenu signalé : support compris (§3). */
  @Patch('signatures/:sid/review')
  @HttpCode(HttpStatus.NO_CONTENT)
  reviewSignature(
    @CurrentUser() actor: AuthUser,
    @Param('sid', ParseUUIDPipe) sid: string,
    @Body() dto: ReviewSignatureDto,
    @ClientIp() ip: string,
  ) {
    return this.admin.reviewSignature(actor, sid, dto, ip);
  }

  @Get('audit-logs')
  @Roles('SUPER_ADMIN')
  auditLogs(@Query() q: AuditQueryDto) {
    return this.admin.auditLogs(q);
  }
}
