import { Module } from '@nestjs/common';
import { LibraryController } from './library.controller';

@Module({
  controllers: [LibraryController],
})
export class LibraryModule {}
