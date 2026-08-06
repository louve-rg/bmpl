import { Global, Module } from '@nestjs/common';
import { StorageService } from './storage.service';
import { UploadIngestService } from './upload-ingest.service';

@Global()
@Module({
  providers: [StorageService, UploadIngestService],
  exports: [StorageService, UploadIngestService],
})
export class StorageModule {}
