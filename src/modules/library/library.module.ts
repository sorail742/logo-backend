import { Module } from '@nestjs/common';
import { LibraryController } from './library.controller';
import { PhotosService } from './photos.service';

@Module({
  controllers: [LibraryController],
  providers: [PhotosService],
})
export class LibraryModule {}
