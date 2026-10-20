import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PLATFORM_ROLE_RANK, WORKSPACE_ROLE_RANK } from '../auth-user';
import { WORKSPACE_ACCESS, WorkspaceAccessOptions } from '../decorators';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Vérifie le rôle de l'utilisateur dans l'espace de travail (§3).
 * L'espace est déduit des paramètres de route : :wid, :pid, :nid, :lid, :did, :jid, :kid
 * (kit), :cid (commentaire), :sid (signature ou slogan).
 */
@Injectable()
export class WorkspaceGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const opts = this.reflector.getAllAndOverride<WorkspaceAccessOptions | undefined>(
      WORKSPACE_ACCESS,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (!opts) return true;

    const req = ctx.switchToHttp().getRequest<Request>();
    const user = req.user;
    if (!user) throw new ForbiddenException();

    const { workspaceId, projectId } = await this.resolve(
      req.params as Record<string, string>,
      opts.includeDeleted ?? false,
    );

    const membership = await this.prisma.membership.findUnique({
      where: { userId_workspaceId: { userId: user.id, workspaceId } },
      select: { role: true },
    });

    if (membership && WORKSPACE_ROLE_RANK[membership.role] >= WORKSPACE_ROLE_RANK[opts.role]) {
      req.workspace = { workspaceId, projectId, role: membership.role };
      return true;
    }

    // Accès plateforme (support en lecture, admin pour la suppression…), avec 2FA obligatoire.
    if (opts.staff && PLATFORM_ROLE_RANK[user.role] >= PLATFORM_ROLE_RANK[opts.staff] && user.mfa) {
      req.workspace = { workspaceId, projectId, role: null };
      return true;
    }

    // Un non-membre ne doit pas savoir que la ressource existe.
    if (!membership) throw new NotFoundException('Ressource introuvable');
    throw new ForbiddenException('Rôle insuffisant dans cet espace');
  }

  private async resolve(
    params: Record<string, string>,
    includeDeleted: boolean,
  ): Promise<{ workspaceId: string; projectId?: string }> {
    if (params.wid) {
      const ws = await this.prisma.workspace.findUnique({
        where: { id: params.wid },
        select: { id: true },
      });
      if (!ws) throw new NotFoundException('Espace introuvable');
      return { workspaceId: ws.id };
    }

    let projectId: string | undefined = params.pid;
    if (!projectId && params.nid) {
      const name = await this.prisma.nameSuggestion.findUnique({
        where: { id: params.nid },
        select: { projectId: true },
      });
      projectId = name?.projectId;
    }
    if (!projectId && params.lid) {
      const logo = await this.prisma.logo.findUnique({
        where: { id: params.lid },
        select: { projectId: true },
      });
      projectId = logo?.projectId;
    }
    if (!projectId && params.did) {
      const design = await this.prisma.apparelDesign.findUnique({
        where: { id: params.did },
        select: { projectId: true },
      });
      projectId = design?.projectId;
    }
    if (!projectId && params.sid) {
      const signature = await this.prisma.signature.findUnique({
        where: { id: params.sid },
        select: { projectId: true },
      });
      const slogan = signature
        ? null
        : await this.prisma.slogan.findUnique({
            where: { id: params.sid },
            select: { projectId: true },
          });
      projectId = signature?.projectId ?? slogan?.projectId;
    }
    if (!projectId && params.kid) {
      const kit = await this.prisma.brandKit.findUnique({
        where: { id: params.kid },
        select: { projectId: true },
      });
      projectId = kit?.projectId;
    }
    if (!projectId && params.cid) {
      const comment = await this.prisma.comment.findUnique({
        where: { id: params.cid },
        select: { projectId: true },
      });
      projectId = comment?.projectId;
    }
    if (!projectId && params.jid) {
      const job = await this.prisma.generationJob.findUnique({
        where: { id: params.jid },
        select: { projectId: true },
      });
      projectId = job?.projectId;
    }
    if (!projectId) throw new NotFoundException('Ressource introuvable');

    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, workspaceId: true, deletedAt: true },
    });
    if (!project || (project.deletedAt && !includeDeleted)) {
      throw new NotFoundException('Projet introuvable');
    }
    return { workspaceId: project.workspaceId, projectId: project.id };
  }
}
