import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-cookies-page',
  imports: [CommonModule, RouterLink],
  templateUrl: './cookies.page.html'
})
export class CookiesPage {}
