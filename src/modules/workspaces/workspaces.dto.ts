import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WorkspaceRole } from '@prisma/client';
import { IsEmail, IsIn, IsOptional, IsString, Length } from 'class-validator';

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
}

const INVITABLE_ROLES = [WorkspaceRole.EDITOR, WorkspaceRole.VIEWER] as const;

export class CreateInvitationDto {
  @ApiPropertyOptional({
    description: 'Absent : crée un lien d’invitation réutilisable jusqu’à expiration',
  })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiProperty({ enum: INVITABLE_ROLES })
  @IsIn(INVITABLE_ROLES)
  role: WorkspaceRole;
}

export class UpdateMemberDto {
  @ApiProperty({ enum: WorkspaceRole })
  @IsIn(Object.values(WorkspaceRole))
  role: WorkspaceRole;
}
