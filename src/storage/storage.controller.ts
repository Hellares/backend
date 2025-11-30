import {
  Controller,
  Post,
  Delete,
  Get,
  Param,
  Query,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiConsumes,
  ApiBody,
  ApiBearerAuth,
  ApiResponse,
} from '@nestjs/swagger';
import { StorageService } from './storage.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UploadArchivoDto, ArchivoResponseDto } from './dto/upload-archivo.dto';
import { EntidadTipo, ProveedorStorage } from '@prisma/client';

@ApiTags('Storage')
@Controller('storage')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class StorageController {
  constructor(private readonly storageService: StorageService) {}

  @Post('upload')
  @ApiOperation({ summary: 'Subir un archivo' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'empresaId'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
        empresaId: { type: 'string' },
        entidadTipo: { type: 'string', enum: Object.values(EntidadTipo) },
        entidadId: { type: 'string' },
        categoria: { type: 'string' },
        orden: { type: 'number' },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Archivo subido exitosamente',
    type: ArchivoResponseDto,
  })
  @UseInterceptors(FileInterceptor('file'))
  async uploadArchivo(
    @UploadedFile() file: Express.Multer.File,
    @Body() uploadDto: UploadArchivoDto,
    @CurrentUser() user: any,
  ) {
    if (!file) {
      throw new BadRequestException('No se proporcionó ningún archivo');
    }

    return await this.storageService.uploadArchivo({
      empresaId: uploadDto.empresaId,
      file,
      entidadTipo: uploadDto.entidadTipo,
      entidadId: uploadDto.entidadId,
      categoria: uploadDto.categoria,
      orden: uploadDto.orden,
      subidoPor: user.sub,
    });
  }

  @Delete(':archivoId')
  @ApiOperation({ summary: 'Eliminar un archivo' })
  @ApiResponse({ status: 200, description: 'Archivo eliminado exitosamente' })
  async deleteArchivo(
    @Param('archivoId') archivoId: string,
    @Query('empresaId') empresaId: string,
  ) {
    return await this.storageService.deleteArchivo(archivoId, empresaId);
  }

  @Get('entidad/:entidadTipo/:entidadId')
  @ApiOperation({ summary: 'Obtener archivos de una entidad' })
  @ApiResponse({
    status: 200,
    description: 'Archivos obtenidos exitosamente',
    type: [ArchivoResponseDto],
  })
  async getArchivosByEntidad(
    @Param('entidadTipo') entidadTipo: EntidadTipo,
    @Param('entidadId') entidadId: string,
    @Query('empresaId') empresaId: string,
  ) {
    return await this.storageService.getArchivosByEntidad(
      empresaId,
      entidadTipo,
      entidadId,
    );
  }

  @Post('migrate')
  @ApiOperation({ summary: 'Migrar archivos a otro proveedor' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['empresaId', 'targetProvider'],
      properties: {
        empresaId: { type: 'string' },
        targetProvider: {
          type: 'string',
          enum: Object.values(ProveedorStorage),
        },
      },
    },
  })
  async migrateToProvider(
    @Body() body: { empresaId: string; targetProvider: ProveedorStorage },
  ) {
    return await this.storageService.migrateToProvider(
      body.empresaId,
      body.targetProvider,
    );
  }
}
