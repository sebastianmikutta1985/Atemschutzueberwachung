import { Routes } from '@angular/router';
import { DashboardPage } from './dashboard.page';
import { SettingsPage } from './settings.page';
import { LoginPage } from './login.page';
import { ManufacturerPage } from './manufacturer.page';
import { adminGuard } from './admin.guard';
import { authGuard } from './auth.guard';

export const routes: Routes = [
  { path: 'login', component: LoginPage },
  { path: 'hersteller', component: ManufacturerPage },
  { path: '', component: DashboardPage, canActivate: [authGuard] },
  { path: 'einstellungen', component: SettingsPage, canActivate: [authGuard, adminGuard] },
  { path: '**', redirectTo: '' }
];
