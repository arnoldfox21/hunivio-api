import { Controller, Get, Query } from '@nestjs/common';
import { LocationsService } from './locations.service';

@Controller('locations')
export class LocationsController {
  constructor(private readonly locationsService: LocationsService) {}

  @Get('cities')
  searchCities(@Query('q') q?: string) {
    return this.locationsService.searchCities(q);
  }

  @Get('districts')
  searchDistricts(@Query('city') city?: string, @Query('q') q?: string) {
    return this.locationsService.searchDistricts(city, q);
  }
}
