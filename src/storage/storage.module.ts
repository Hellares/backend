import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { StorageController } from './storage.controller';
import { StorageService } from './storage.service';
import { CloudinaryProvider } from './providers/cloudinary.provider';
import { ContaboProvider } from './providers/contabo.provider';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [ConfigModule, PrismaModule],
  controllers: [StorageController],
  providers: [StorageService, CloudinaryProvider, ContaboProvider],
  exports: [StorageService],
})
export class StorageModule {}
