import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser, WorkspaceContext } from '../../common/auth-user';
import { CurrentUser, CurrentWorkspace, WorkspaceAccess } from '../../common/decorators';
import { AuditService } from '../audit/audit.service';
import { projectEvent } from '../projects/project-activity';
import { CreateCommentDto, ListCommentsDto } from './comments.dto';
import { CommentsService } from './comments.service';

/** Commentaires (COL-02, §13.7) : tout membre de l'espace, lecteur compris ; pas le support. */
@ApiTags('comments')
@ApiBearerAuth()
@Controller()
export class CommentsController {
  constructor(
    private readonly comments: CommentsService,
    private readonly audit: AuditService,
  ) {}

  @Get('projects/:pid/comments')
  @WorkspaceAccess('VIEWER')
  list(
    @Param('pid', ParseUUIDPipe) pid: string,
    @Query() q: ListCommentsDto,
    @CurrentWorkspace() ws: WorkspaceContext,
  ) {
    return this.comments.list(pid, ws.workspaceId, q);
  }

  @Post('projects/:pid/comments')
  @WorkspaceAccess('VIEWER', { staff: undefined })
  async create(
    @Param('pid', ParseUUIDPipe) pid: string,
    @Body() dto: CreateCommentDto,
    @CurrentUser() user: AuthUser,
    @CurrentWorkspace() ws: WorkspaceContext,
  ) {
    const { comment, target } = await this.comments.create(
      { projectId: pid, workspaceId: ws.workspaceId, actorId: user.id },
      dto,
    );
    await this.audit.log(projectEvent(pid, user.id, 'comments.create', { target }));
    return comment;
  }

  @Delete('comments/:cid')
  @WorkspaceAccess('VIEWER', { staff: undefined })
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('cid', ParseUUIDPipe) cid: string,
    @CurrentUser() user: AuthUser,
    @CurrentWorkspace() ws: WorkspaceContext,
  ) {
    return this.comments.remove(cid, user.id, ws.role);
  }
}
