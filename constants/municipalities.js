// Kıbrıs Türk Belediyeler Birliği members, moved out of App.js JSX (redesign Slice 2).
// Names are proper names and stay Turkish in every locale; hours are shared by all
// (hrMuniHours* keys). mapQuery feeds a Google Maps search URL.
export const MUNICIPALITIES = [
  { name: 'Lefkoşa', phone: '03922285221', mapQuery: 'Lefkoşa Türk Belediyesi' },
  { name: 'Gazimağusa', phone: '03923665332', mapQuery: 'Gazimağusa Belediyesi Fazıl Polatpaşa Bulvarı Gazimağusa KKTC' },
  { name: 'Girne', phone: '03928152118', mapQuery: 'Girne Belediyesi Ecevit Caddesi 68 Girne KKTC' },
  { name: 'Gönyeli-Alayköy', phone: '03922231901', mapQuery: 'Gönyeli Belediyesi Belediye Bulvarı 30 Yenikent Gönyeli KKTC' },
  { name: 'Lapta-Alsancak-Çamlıbel', phone: '03928228623', mapQuery: 'Lapta Belediyesi Lapta Girne KKTC' },
  { name: 'Güzelyurt', phone: '03927142813', mapQuery: 'Güzelyurt Belediyesi Alemdar Sokak 14 Güzelyurt KKTC' },
  { name: 'Değirmenlik-Akıncılar', phone: '03922323322', mapQuery: 'Değirmenlik Belediyesi Başpınar Yolu Sokak 27 Değirmenlik KKTC' },
  { name: 'Dikmen', phone: '03922372863', mapQuery: 'Dikmen Belediyesi 20 Temmuz Caddesi Dikmen Girne KKTC' },
  { name: 'Lefke', phone: '03927287347', mapQuery: 'Lefke Belediyesi Tahir Efendi Sokak 1 Lefke KKTC' },
  { name: 'Mesarya', phone: '03923777459', mapQuery: 'Mesarya Belediyesi Ulus Ülfet Sokak 6 Akdoğan KKTC' },
  { name: 'Çatalköy-Esentepe', phone: '03928244068', mapQuery: 'Çatalköy Belediyesi Mücahit Sokak 10 Çatalköy Girne KKTC' },
  { name: 'İskele', phone: '03923712521', mapQuery: 'İskele Belediyesi Bozdağ Sokak 4 İskele KKTC' },
  { name: 'Erenköy-Karpaz', phone: '03923744350', mapQuery: 'Yeni Erenköy Belediyesi İstiklal Caddesi Yeni Erenköy İskele KKTC' },
  { name: 'Yeni Boğaziçi', phone: '03923788145', mapQuery: 'Yeniboğaziçi Belediyesi İstiklal Caddesi Yeniboğaziçi Gazimağusa KKTC' },
  { name: 'Geçitkale-Serdarlı', phone: '03923733147', mapQuery: 'Geçitkale Belediyesi Ecevit Caddesi 70 Geçitkale Gazimağusa KKTC' },
  { name: 'Mehmetçik-Büyükkonuk', phone: '03923755090', mapQuery: 'Mehmetçik Belediyesi Atatürk Meydanı 3 Mehmetçik İskele KKTC' },
  { name: 'Beyarmudu', phone: '03923799401', mapQuery: 'Beyarmudu Belediyesi Hüseyin Kafa Caddesi 68 Beyarmudu Gazimağusa KKTC' },
  { name: 'Tatlısu', phone: '03923892026', mapQuery: 'Tatlısu Belediyesi Cumhuriyet Sokak 9 Tatlısu Gazimağusa KKTC' },
]
