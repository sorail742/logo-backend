import { Module } from '@nestjs/common';
import { StudioModule } from '../studio/studio.module';
import { LibraryController } from './library.controller';
import { PhotosService } from './photos.service';

@Module({
  imports: [StudioModule],
  controllers: [LibraryController],
  providers: [PhotosService],
})
export class LibraryModule {}
