import { Routes } from '@angular/router';
import { DashboardPage } from './dashboard.page';
import { SettingsPage } from './settings.page';
import { LoginPage } from './login.page';
import { ManufacturerPage } from './manufacturer.page';
import { ImpressumPage } from './impressum.page';
import { DatenschutzPage } from './datenschutz.page';
import { CookiesPage } from './cookies.page';
import { adminGuard } from './admin.guard';
import { authGuard } from './auth.guard';
import { systemGuard } from './system.guard';

export const routes: Routes = [
  { path: 'login', component: LoginPage },
  { path: 'admin-login', component: ManufacturerPage },
  { path: 'admin', component: ManufacturerPage, canActivate: [systemGuard] },
  { path: 'impressum', component: ImpressumPage },
  { path: 'datenschutz', component: DatenschutzPage },
  { path: 'cookies', component: CookiesPage },
  { path: '', component: DashboardPage, canActivate: [authGuard] },
  { path: 'einstellungen', component: SettingsPage, canActivate: [authGuard, adminGuard] },
  { path: '**', redirectTo: '' }
];
