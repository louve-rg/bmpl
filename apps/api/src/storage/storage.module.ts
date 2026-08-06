import { Global, Module } from '@nestjs/common';
import { StorageService } from './storage.service';
import { UploadIngestService } from './upload-ingest.service';
import { AvatarVisionService } from './avatar-vision.service';

@Global()
@Module({
  providers: [StorageService, UploadIngestService, AvatarVisionService],
  exports: [StorageService, UploadIngestService, AvatarVisionService],
})
export class StorageModule {}
