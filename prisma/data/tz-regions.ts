/**
 * The 31 administrative regions of Tanzania (26 mainland + 5 Zanzibar) with their districts.
 * Codes follow ISO 3166-2:TZ. Wards are entered as free text on addresses.
 */
export interface RegionSeed {
  code: string;
  name: string;
  districts: string[];
}

export const TZ_REGIONS: RegionSeed[] = [
  {
    code: 'TZ-01',
    name: 'Arusha',
    districts: [
      'Arusha City',
      'Arusha Rural',
      'Karatu',
      'Longido',
      'Meru',
      'Monduli',
      'Ngorongoro',
    ],
  },
  {
    code: 'TZ-02',
    name: 'Dar es Salaam',
    districts: ['Ilala', 'Kigamboni', 'Kinondoni', 'Temeke', 'Ubungo'],
  },
  {
    code: 'TZ-03',
    name: 'Dodoma',
    districts: ['Bahi', 'Chamwino', 'Chemba', 'Dodoma City', 'Kondoa', 'Kongwa', 'Mpwapwa'],
  },
  {
    code: 'TZ-04',
    name: 'Iringa',
    districts: ['Iringa Municipal', 'Iringa Rural', 'Kilolo', 'Mafinga Town', 'Mufindi'],
  },
  {
    code: 'TZ-05',
    name: 'Kagera',
    districts: [
      'Biharamulo',
      'Bukoba Municipal',
      'Bukoba Rural',
      'Karagwe',
      'Kyerwa',
      'Missenyi',
      'Muleba',
      'Ngara',
    ],
  },
  { code: 'TZ-06', name: 'Kaskazini Pemba', districts: ['Micheweni', 'Wete'] },
  { code: 'TZ-07', name: 'Kaskazini Unguja', districts: ['Kaskazini A', 'Kaskazini B'] },
  {
    code: 'TZ-08',
    name: 'Kigoma',
    districts: ['Buhigwe', 'Kakonko', 'Kasulu', 'Kibondo', 'Kigoma', 'Uvinza'],
  },
  {
    code: 'TZ-09',
    name: 'Kilimanjaro',
    districts: ['Hai', 'Moshi Municipal', 'Moshi Rural', 'Mwanga', 'Rombo', 'Same', 'Siha'],
  },
  { code: 'TZ-10', name: 'Kusini Pemba', districts: ['Chake Chake', 'Mkoani'] },
  { code: 'TZ-11', name: 'Kusini Unguja', districts: ['Kati', 'Kusini'] },
  {
    code: 'TZ-12',
    name: 'Lindi',
    districts: ['Kilwa', 'Lindi', 'Liwale', 'Nachingwea', 'Ruangwa'],
  },
  {
    code: 'TZ-13',
    name: 'Mara',
    districts: ['Bunda', 'Butiama', 'Musoma', 'Rorya', 'Serengeti', 'Tarime'],
  },
  {
    code: 'TZ-14',
    name: 'Mbeya',
    districts: ['Chunya', 'Kyela', 'Mbarali', 'Mbeya City', 'Mbeya Rural', 'Rungwe'],
  },
  {
    code: 'TZ-15',
    name: 'Mjini Magharibi',
    districts: ['Magharibi A', 'Magharibi B', 'Mjini'],
  },
  {
    code: 'TZ-16',
    name: 'Morogoro',
    districts: ['Gairo', 'Kilombero', 'Kilosa', 'Malinyi', 'Morogoro', 'Mvomero', 'Ulanga'],
  },
  {
    code: 'TZ-17',
    name: 'Mtwara',
    districts: ['Masasi', 'Mtwara', 'Nanyumbu', 'Newala', 'Tandahimba'],
  },
  {
    code: 'TZ-18',
    name: 'Mwanza',
    districts: ['Ilemela', 'Kwimba', 'Magu', 'Misungwi', 'Nyamagana', 'Sengerema', 'Ukerewe'],
  },
  {
    code: 'TZ-19',
    name: 'Pwani',
    districts: ['Bagamoyo', 'Kibaha', 'Kibiti', 'Kisarawe', 'Mafia', 'Mkuranga', 'Rufiji'],
  },
  { code: 'TZ-20', name: 'Rukwa', districts: ['Kalambo', 'Nkasi', 'Sumbawanga'] },
  {
    code: 'TZ-21',
    name: 'Ruvuma',
    districts: ['Mbinga', 'Namtumbo', 'Nyasa', 'Songea', 'Tunduru'],
  },
  { code: 'TZ-22', name: 'Shinyanga', districts: ['Kahama', 'Kishapu', 'Shinyanga'] },
  {
    code: 'TZ-23',
    name: 'Singida',
    districts: ['Ikungi', 'Iramba', 'Manyoni', 'Mkalama', 'Singida'],
  },
  {
    code: 'TZ-24',
    name: 'Tabora',
    districts: ['Igunga', 'Kaliua', 'Nzega', 'Sikonge', 'Tabora', 'Urambo', 'Uyui'],
  },
  {
    code: 'TZ-25',
    name: 'Tanga',
    districts: ['Handeni', 'Kilindi', 'Korogwe', 'Lushoto', 'Mkinga', 'Muheza', 'Pangani', 'Tanga'],
  },
  {
    code: 'TZ-26',
    name: 'Manyara',
    districts: ['Babati', 'Hanang', 'Kiteto', 'Mbulu', 'Simanjiro'],
  },
  {
    code: 'TZ-27',
    name: 'Geita',
    districts: ['Bukombe', 'Chato', 'Geita', 'Mbogwe', "Nyang'hwale"],
  },
  { code: 'TZ-28', name: 'Katavi', districts: ['Mlele', 'Mpanda', 'Tanganyika'] },
  {
    code: 'TZ-29',
    name: 'Njombe',
    districts: ['Ludewa', 'Makete', 'Njombe', "Wanging'ombe"],
  },
  {
    code: 'TZ-30',
    name: 'Simiyu',
    districts: ['Bariadi', 'Busega', 'Itilima', 'Maswa', 'Meatu'],
  },
  { code: 'TZ-31', name: 'Songwe', districts: ['Ileje', 'Mbozi', 'Momba', 'Songwe'] },
];
