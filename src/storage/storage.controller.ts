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
import { CacheService } from '../redis/cache.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantAuthGuard } from '../auth/guards/tenant-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequiresPermission } from '../auth/decorators/requires-permission.decorator';
import { Permission } from '../auth/enums/permission.enum';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UploadArchivoDto, ArchivoResponseDto } from './dto/upload-archivo.dto';
import { EntidadTipo, ProveedorStorage } from '@prisma/client';

@ApiTags('Storage')
@Controller('storage')
@UseGuards(JwtAuthGuard, TenantAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class StorageController {
  constructor(
    private readonly storageService: StorageService,
    private readonly cache: CacheService,
  ) {}

  @Post('upload')
  @RequiresPermission(Permission.MANAGE_SETTINGS)
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
    @UploadedFile() file: any,
    @Body() uploadDto: UploadArchivoDto,
    @CurrentUser() user: any,
  ) {
    if (!file) {
      throw new BadRequestException('No se proporcionó ningún archivo');
    }

    const result = await this.storageService.uploadArchivo({
      empresaId: uploadDto.empresaId,
      file,
      entidadTipo: uploadDto.entidadTipo || undefined,
      entidadId: uploadDto.entidadId || undefined,
      categoria: uploadDto.categoria || undefined,
      orden: uploadDto.orden,
      subidoPor: user.sub,
    });

    // Invalidar caches
    if (uploadDto.entidadTipo === 'PRODUCTO' || uploadDto.entidadTipo === 'PRODUCTO_VARIANTE') {
      await this.cache.invalidateProductosLists(uploadDto.empresaId);
    }
    await this.cache.invalidateEmpresa(uploadDto.empresaId);

    return result;
  }

  @Delete(':archivoId')
  @RequiresPermission(Permission.MANAGE_SETTINGS)
  @ApiOperation({ summary: 'Eliminar un archivo' })
  @ApiResponse({ status: 200, description: 'Archivo eliminado exitosamente' })
  async deleteArchivo(
    @Param('archivoId') archivoId: string,
    @Query('empresaId') empresaId: string,
  ) {
    // Obtener el archivo antes de eliminarlo para saber su entidadTipo
    const archivo = await this.storageService['prisma'].archivo.findUnique({
      where: { id: archivoId },
      select: { entidadTipo: true },
    });

    const result = await this.storageService.deleteArchivo(archivoId, empresaId);

    // Invalidar caches
    if (archivo?.entidadTipo === 'PRODUCTO' || archivo?.entidadTipo === 'PRODUCTO_VARIANTE') {
      await this.cache.invalidateProductosLists(empresaId);
    }
    await this.cache.invalidateEmpresa(empresaId);

    return result;
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

  @Get('galeria')
  @RequiresPermission(Permission.MANAGE_SETTINGS)
  @ApiOperation({ summary: 'Listar todos los archivos de la empresa (galería multimedia)' })
  async getGaleriaEmpresa(
    @Query('empresaId') empresaId: string,
    @Query('tipoArchivo') tipoArchivo?: string,
    @Query('entidadTipo') entidadTipo?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('orderBy') orderBy?: string,
  ) {
    return await this.storageService.getGaleriaEmpresa({
      empresaId,
      tipoArchivo: tipoArchivo || undefined,
      entidadTipo: entidadTipo || undefined,
      page: parseInt(page || '1'),
      limit: parseInt(limit || '50'),
      orderBy: (orderBy as 'recientes' | 'antiguos' | 'mayor' | 'menor') || 'recientes',
    });
  }

  @Get('galeria/stats')
  @RequiresPermission(Permission.MANAGE_SETTINGS)
  @ApiOperation({ summary: 'Estadísticas de almacenamiento de la empresa' })
  async getGaleriaStats(
    @Query('empresaId') empresaId: string,
  ) {
    return await this.storageService.getGaleriaStats(empresaId);
  }

  @Post('migrate')
  @RequiresPermission(Permission.MANAGE_SETTINGS)
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
