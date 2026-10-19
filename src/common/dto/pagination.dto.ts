import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

/** Pagination par curseur : ?cursor=<id>&limit=20 (100 max, §13.1). */
export class CursorPaginationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  cursor?: string;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/** Lit limit+1 éléments pour savoir s'il reste une page. */
export function toPage<T extends { id: string }>(rows: T[], limit: number): Page<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
}

export function cursorArgs(p: CursorPaginationDto) {
  return {
    take: p.limit + 1,
    ...(p.cursor ? { cursor: { id: p.cursor }, skip: 1 } : {}),
  };
}
