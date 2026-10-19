import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, IsUrl, Length, Matches } from 'class-validator';
import type { AuthUser } from '../../common/auth-user';
import { CurrentUser } from '../../common/decorators';
import { UsersService } from './users.service';

export class UpdateMeDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(2, 120)
  fullName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  avatarUrl?: string;

  @ApiPropertyOptional({ enum: ['fr', 'en'] })
  @IsOptional()
  @Matches(/^(fr|en)$/)
  locale?: string;

  @ApiPropertyOptional({ example: 'GN', description: 'Code pays ISO 3166-1 alpha-2' })
  @IsOptional()
  @Matches(/^[A-Z]{2}$/)
  country?: string;
}

@ApiTags('me')
@ApiBearerAuth()
@Controller('me')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  me(@CurrentUser() user: AuthUser) {
    return this.users.profile(user.id);
  }

  @Patch()
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdateMeDto) {
    return this.users.update(user.id, dto);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthUser) {
    return this.users.softDelete(user.id);
  }

  /** Export des données personnelles (§14.3). */
  @Get('export')
  export(@CurrentUser() user: AuthUser) {
    return this.users.exportData(user.id);
  }
}
