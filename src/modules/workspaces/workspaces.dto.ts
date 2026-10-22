import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WorkspaceRole } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, Length } from 'class-validator';

export class CreateWorkspaceDto {
  @ApiProperty({ example: 'Association Jeunesse Verte' })
  @IsString()
  @Length(2, 80)
  name: string;
}

export class UpdateWorkspaceDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(2, 80)
  name?: string;

  @ApiPropertyOptional({ description: 'Les lecteurs peuvent télécharger fichiers et exports (§3)' })
  @IsOptional()
  @IsBoolean()
  viewerDownloads?: boolean;
}

export class DeleteWorkspaceDto {
  @ApiProperty({ description: 'Nom exact de l’espace, en confirmation' })
  @IsString()
  @Length(1, 80)
  confirm: string;
}

const INVITABLE_ROLES = [WorkspaceRole.EDITOR, WorkspaceRole.VIEWER] as const;

export class CreateInvitationDto {
  @ApiPropertyOptional({
    description: 'Absent : crée un lien d’invitation réutilisable jusqu’à expiration',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (value === '' ? undefined : value))
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ description: 'Créer un lien d’invitation même si une adresse est fournie' })
  @IsOptional()
  @IsBoolean()
  asLink?: boolean;

  @ApiProperty({ enum: INVITABLE_ROLES })
  @IsIn(INVITABLE_ROLES)
  role: WorkspaceRole;
}

export class UpdateMemberDto {
  @ApiProperty({ enum: WorkspaceRole })
  @IsIn(Object.values(WorkspaceRole))
  role: WorkspaceRole;
}
