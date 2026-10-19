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
import type { AuthUser } from '../../common/auth-user';
import { CurrentUser, WorkspaceAccess } from '../../common/decorators';
import {
  CreateInvitationDto,
  CreateWorkspaceDto,
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
  get(@Param('wid', ParseUUIDPipe) wid: string) {
    return this.workspaces.get(wid);
  }

  @Patch('workspaces/:wid')
  @WorkspaceAccess('OWNER')
  update(@Param('wid', ParseUUIDPipe) wid: string, @Body() dto: UpdateWorkspaceDto) {
    return this.workspaces.update(wid, dto);
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
  ) {
    return this.workspaces.updateMember(wid, uid, dto.role);
  }

  @Delete('workspaces/:wid/members/:uid')
  @WorkspaceAccess('OWNER')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeMember(@Param('wid', ParseUUIDPipe) wid: string, @Param('uid', ParseUUIDPipe) uid: string) {
    return this.workspaces.removeMember(wid, uid);
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
