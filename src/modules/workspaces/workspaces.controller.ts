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
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PlatformRole } from '@prisma/client';
import type { AuthUser, WorkspaceContext } from '../../common/auth-user';
import { CurrentUser, CurrentWorkspace, WorkspaceAccess } from '../../common/decorators';
import {
  CreateInvitationDto,
  CreateWorkspaceDto,
  DeleteWorkspaceDto,
  UpdateMemberDto,
  UpdateWorkspaceDto,
} from './workspaces.dto';
import { WorkspacesService } from './workspaces.service';

@ApiTags('workspaces')
@ApiBearerAuth()
@Controller()
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}

  @Get('workspaces')
  list(@CurrentUser() user: AuthUser) {
    return this.workspaces.list(user.id);
  }

  @Post('workspaces')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateWorkspaceDto) {
    return this.workspaces.create(user.id, dto);
  }

  @Get('workspaces/:wid')
  @WorkspaceAccess('VIEWER')
  get(
    @Param('wid', ParseUUIDPipe) wid: string,
    @CurrentUser() user: AuthUser,
    @CurrentWorkspace() ws: WorkspaceContext,
  ) {
    return this.workspaces.get(wid, user.id, ws.role);
  }

  @Patch('workspaces/:wid')
  @WorkspaceAccess('OWNER')
  update(
    @Param('wid', ParseUUIDPipe) wid: string,
    @Body() dto: UpdateWorkspaceDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.workspaces.update(wid, user.id, dto);
  }

  /** Suppression de l'espace (§3 : propriétaire, ou admin avec double authentification). */
  @Delete('workspaces/:wid')
  @WorkspaceAccess('OWNER', { staff: PlatformRole.ADMIN })
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('wid', ParseUUIDPipe) wid: string,
    @Body() dto: DeleteWorkspaceDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.workspaces.remove(wid, user.id, dto);
  }

  @Get('workspaces/:wid/members')
  @WorkspaceAccess('VIEWER')
  members(@Param('wid', ParseUUIDPipe) wid: string) {
    return this.workspaces.members(wid);
  }

  @Patch('workspaces/:wid/members/:uid')
  @WorkspaceAccess('OWNER')
  updateMember(
    @Param('wid', ParseUUIDPipe) wid: string,
    @Param('uid', ParseUUIDPipe) uid: string,
    @Body() dto: UpdateMemberDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.workspaces.updateMember(wid, uid, dto.role, user.id);
  }

  /** Retrait d'un membre (propriétaire) ou départ volontaire (tout membre, uid = soi-même). */
  @Delete('workspaces/:wid/members/:uid')
  @WorkspaceAccess('VIEWER', { staff: undefined })
  @HttpCode(HttpStatus.NO_CONTENT)
  removeMember(
    @Param('wid', ParseUUIDPipe) wid: string,
    @Param('uid', ParseUUIDPipe) uid: string,
    @CurrentUser() user: AuthUser,
    @CurrentWorkspace() ws: WorkspaceContext,
  ) {
    return this.workspaces.removeMember(wid, uid, { id: user.id, role: ws.role });
  }

  @Get('workspaces/:wid/invitations')
  @WorkspaceAccess('OWNER')
  invitations(@Param('wid', ParseUUIDPipe) wid: string) {
    return this.workspaces.invitations(wid);
  }

  @Post('workspaces/:wid/invitations')
  @WorkspaceAccess('OWNER')
  invite(@Param('wid', ParseUUIDPipe) wid: string, @Body() dto: CreateInvitationDto) {
    return this.workspaces.invite(wid, dto);
  }

  @Post('invitations/:token/accept')
  @HttpCode(HttpStatus.OK)
  accept(@Param('token') token: string, @CurrentUser() user: AuthUser) {
    return this.workspaces.accept(token, user);
  }
}
