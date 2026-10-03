export interface BattleNetProduct {
  titleId: number | null
  productId: string
  uid: string
  name: string
  cover?: string
  background?: string
  icon?: string
}

export const BATTLENET_PRODUCTS: BattleNetProduct[] = [
  {
    titleId: 5730135,
    productId: "WoW",
    uid: "wow",
    name: "World of Warcraft",
    cover: "https://bnetproduct-a.akamaihd.net//fab/a25ed0ddd3225929bc3ad5139ebc7483-prod-card-tall.jpg",
    background: "https://bnetproduct-a.akamaihd.net//fe4/e09d3a01538f92686e2d7e30dc89ee1e-prod-mobile-bg.jpg",
    icon: "https://blznav.akamaized.net/img/games/logo-wow-3dd2cfe06df74407.png"
  },
  {
    titleId: 17459,
    productId: "D3",
    uid: "diablo3",
    name: "Diablo III",
    cover: "https://bnetproduct-a.akamaihd.net//fbd/bafaafcfb7c6c620067662a04409ba66-prod-card-tall.jpg",
    background: "https://bnetproduct-a.akamaihd.net//fad/6a06a79f8b1134a80d794dc24c9cd2d1-prod-mobile-bg.jpg",
    icon: "https://blznav.akamaized.net/img/games/logo-d3-ab08e4045fed09ee.png"
  },
  {
    titleId: 21298,
    productId: "S2",
    uid: "s2",
    name: "StarCraft II",
    cover: "https://bnetproduct-a.akamaihd.net//fd8/18fb5862b6d5aea418ad4102ed48aa63-prod-card-tall.jpg",
    background: "https://bnetproduct-a.akamaihd.net//fcd/ab0419d498190f5f2ccf69414265b70b-prod-mobile-bg.jpg",
    icon: "https://blznav.akamaized.net/img/games/logo-sc2-6e33583ba0547b6a.png"
  },
  {
    titleId: 21297,
    productId: "S1",
    uid: "s1",
    name: "StarCraft",
    cover: "https://bnetproduct-a.akamaihd.net//f95/6d9453be1750dbf035f0ee574cff2c25-prod-card-tall.jpg",
    background: "https://bnetproduct-a.akamaihd.net//fb2/eb1b3feb5cc03da2d05f3e9e88aaec2a-prod-mobile-bg.jpg",
    icon: "https://blznav.akamaized.net/img/games/logo-scr-fef4f892c20f584c.png"
  },
  {
    titleId: 1465140039,
    productId: "WTCG",
    uid: "hs_beta",
    name: "Hearthstone",
    cover: "https://bnetproduct-a.akamaihd.net//f89/c074270c5024a5bb627d46cddf024dad-prod-card-tall.jpg",
    background: "https://bnetproduct-a.akamaihd.net//fac/895ca992a21d9c960bd30f9738d7bfb8-prod-mobile-bg.jpg",
    icon: "https://blznav.akamaized.net/img/games/logo-hs-93512467e87f82c6.png"
  },
  {
    titleId: 1214607983,
    productId: "Hero",
    uid: "heroes",
    name: "Heroes of the Storm",
    cover: "https://bnetproduct-a.akamaihd.net//f8c/0f2efeb8d64127edb647a95c236c92ba-prod-card-tall.jpg",
    background: "https://bnetproduct-a.akamaihd.net//f88/9eaac80f3496502843198b092eb35b84-prod-mobile-bg.jpg",
    icon: "https://blznav.akamaized.net/img/games/logo-heroes-78cae505b7a524fb.png"
  },
  {
    titleId: 5272175,
    productId: "Pro",
    uid: "prometheus",
    name: "Overwatch 2",
    icon: "https://blznav.akamaized.net/img/games/logo-ow-4be5755bc0a4cbaf.png"
  },
  {
    titleId: 1447645266,
    productId: "VIPR",
    uid: "viper",
    name: "Call of Duty: Black Ops 4",
    cover: "https://bnetproduct-a.akamaihd.net//62/a346ee691a8d0829c5a895200dd17cbf-prod-card-tall-v2.jpg",
    background: "https://bnetproduct-a.akamaihd.net//5d/411c53766cdf6155fcc952f79f304b4a-prod-mobile-bg.jpg",
    icon: "https://blznav.akamaized.net/img/games/logo-codbo4-7794ee86f3e8be3e.png"
  },
  {
    titleId: 1329875278,
    productId: "ODIN",
    uid: "odin",
    name: "Call of Duty: Modern Warfare",
    cover: "https://bnetproduct-a.akamaihd.net//5e/294eb830c6db1959b3db3b4cbbcfe7fc-_Kronos-Bnet_Game-Card_Product_Vert-700x850.jpg",
    background: "https://bnetproduct-a.akamaihd.net//59/326ed260bc958ddd26713761683a4489-_Kronos-Bnet_Game-Shop_Background_Desktop-2280x910.jpg",
    icon: "https://blznav.akamaized.net/img/games/logo-codmw-d57b296321d6b444.png"
  },
  {
    titleId: 22323,
    productId: "W3",
    uid: "w3",
    name: "Warcraft III: Reforged",
    cover: "https://bnetproduct-a.akamaihd.net//5f/3d885e4077747a04a646186a17607769-WC3R_2020_Orc_Art_Shop_Product_Page_Assets_prod-card-vert_TS03.jpg",
    background: "https://bnetproduct-a.akamaihd.net//faf/44004fe111706bac3ad1c9a5c7264d1f-WC3R_2020_Orc_Art_Shop_Product_Page_Assets_prod-full-bg_TS03.jpg",
    icon: "https://blznav.akamaized.net/img/games/logo-w3r-c8a76eea272dbd55.png"
  },
  {
    titleId: 1279351378,
    productId: "LAZR",
    uid: "lazarus",
    name: "Call of Duty: Modern Warfare 2 Campaign Remastered",
    cover: "https://bnetproduct-a.akamaihd.net//f/7e875975619de0671dc538c8d85ba550-Lazarus-Bnet_Placeholder-Card_Product_Vert-700x850-For_2020406-Corrected.jpg",
    background: "https://bnetproduct-a.akamaihd.net//f90/ca5641d89e0495fcd468350d298097d5-Lazarus-Bnet_Placeholder-Shop_Background_Desktop-2280x910-For_20200331.jpg",
    icon: "https://blznav.akamaized.net/img/games/logo-codmw2cr-403ff7094aa97396.png"
  },
  {
    titleId: 1514493267,
    productId: "ZEUS",
    uid: "zeus",
    name: "Call of Duty: Black Ops Cold War",
    cover: "https://bnetproduct-a.akamaihd.net//ffd/a8bbbeddae915be62457bc2799f602d0-CODCW-Bnet_Shop_Prod_Card_Vert-700x850-For_20200826.jpg",
    background: "https://bnetproduct-a.akamaihd.net//60/d4b6308a9c0ffb51f723462ef1bb73b9-CODBO_CW-Bnet_Product_Desktop-Background-2280x910-UPDATE-For_20200826.jpg"
  },
  {
    titleId: 1464615513,
    productId: "WLBY",
    uid: "wlby",
    name: "Crash Bandicoot 4"
  },
  {
    titleId: 5198665,
    productId: "OSI",
    uid: "osi",
    name: "Diablo II: Resurrected",
    cover: "https://bnetproduct-a.akamaihd.net//ffd/a8bbbeddae915be62457bc2799f602d0-CODCW-Bnet_Shop_Prod_Card_Vert-700x850-For_20200826.jpg",
    background: "https://bnetproduct-a.akamaihd.net//ff5/06eb0dec3719105deb1a8c5afe460c06-3i_Battle.netShop_CheckoutThumbnail_960x540_MB01.png"
  },
  {
    titleId: 1381257807,
    productId: "RTRO",
    uid: "rtro",
    name: "Blizzard Arcade Collection"
  },
  {
    titleId: 1179603525,
    productId: "FORE",
    uid: "fore",
    name: "Call of Duty: Vanguard",
    cover: "https://bnetproduct-a.akamaihd.net//6a/238445d222b2b650eec86a37e4c2ba67-CODVG_Reveal_Ultimate_Keyart_Textless-Bnet-Shop_Card_Product_Vert-700x850_02a.jpg",
    background: "https://bnetproduct-a.akamaihd.net//f94/d9d4f33efd0ed10acacf1d032479cd01-CODVG_Reveal_Standard_Keyart_Textless-Bnet-Shop_Background_Desktop-1600x680.jpg"
  },
  {
    titleId: 1095647827,
    productId: "ANBS",
    uid: "anbs",
    name: "Diablo Immortal",
    background: "https://blz-contentstack-images.akamaized.net/v3/assets/blt77f4425de611b362/bltb5cac524dcb261ae/611583c8c8163c2197c3c1f6/di_masthead_desktop-2600.jpg",
    icon: "https://blz-contentstack-images.akamaized.net/v3/assets/blt77f4425de611b362/blt7b64284fbcdfaa77/60e75dd92d26525ef67ac8c5/nav-icon.png"
  },
  {
    titleId: 1096108883,
    productId: "AUKS",
    uid: "auks",
    name: "Call of Duty: Modern Warfare II"
  },
  {
    titleId: 4613486,
    productId: "Fen",
    uid: "Fen",
    name: "Diablo IV"
  },
  {
    titleId: 1146246220,
    productId: "D1",
    uid: "D1",
    name: "Diablo"
  },
  {
    titleId: 5714258,
    productId: "W1R",
    uid: "w1r",
    name: "Warcraft: Remastered"
  },
  {
    titleId: 5714514,
    productId: "W2R",
    uid: "w2r",
    name: "Warcraft II: Remastered"
  },
  {
    titleId: 1463898673,
    productId: "W1",
    uid: "w1",
    name: "Warcraft: Orcs & Humans"
  },
  {
    titleId: 1462911566,
    productId: "W2",
    uid: "w2",
    name: "Warcraft II: Battle.net Edition"
  },
  {
    titleId: 4674137,
    productId: "GRY",
    uid: "gryphon",
    name: "Warcraft Rumble"
  },
  {
    titleId: 1095911763,
    productId: "ARIS",
    uid: "aris",
    name: "Doom: The Dark Ages"
  },
  {
    titleId: 1396920146,
    productId: "SCOR",
    uid: "scorpio",
    name: "Sea of Thieves"
  },
  {
    titleId: 4280907,
    productId: "ARK",
    uid: "arkansas",
    name: "The Outer Worlds 2"
  },
  {
    titleId: 1279414849,
    productId: "LBRA",
    uid: "libra",
    name: "Tony Hawk's Pro Skater 3 + 4"
  },
  {
    titleId: 1096108883,
    productId: "PNTA",
    uid: "pinta",
    name: "Call of Duty: Modern Warfare III"
  },
  {
    titleId: 1095849281,
    productId: "AQUA",
    uid: "aqua",
    name: "Avowed"
  }
]
