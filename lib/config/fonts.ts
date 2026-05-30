export const APP_FONTS = {
  'Aboreto-Regular':           require('../../assets/fonts/Aboreto/Aboreto-Regular.ttf'),

  'AlegreyaSC-Regular':        require('../../assets/fonts/Alegreya_SC/AlegreyaSC-Regular.ttf'),
  'AlegreyaSC-Italic':         require('../../assets/fonts/Alegreya_SC/AlegreyaSC-Italic.ttf'),
  'AlegreyaSC-Medium':         require('../../assets/fonts/Alegreya_SC/AlegreyaSC-Medium.ttf'),
  'AlegreyaSC-MediumItalic':   require('../../assets/fonts/Alegreya_SC/AlegreyaSC-MediumItalic.ttf'),
  'AlegreyaSC-Bold':           require('../../assets/fonts/Alegreya_SC/AlegreyaSC-Bold.ttf'),
  'AlegreyaSC-BoldItalic':     require('../../assets/fonts/Alegreya_SC/AlegreyaSC-BoldItalic.ttf'),
  'AlegreyaSC-ExtraBold':      require('../../assets/fonts/Alegreya_SC/AlegreyaSC-ExtraBold.ttf'),
  'AlegreyaSC-Black':          require('../../assets/fonts/Alegreya_SC/AlegreyaSC-Black.ttf'),

  'Fredoka-Light':             require('../../assets/fonts/Fredoka/static/Fredoka-Light.ttf'),
  'Fredoka-Regular':           require('../../assets/fonts/Fredoka/static/Fredoka-Regular.ttf'),
  'Fredoka-Medium':            require('../../assets/fonts/Fredoka/static/Fredoka-Medium.ttf'),
  'Fredoka-SemiBold':          require('../../assets/fonts/Fredoka/static/Fredoka-SemiBold.ttf'),
  'Fredoka-Bold':              require('../../assets/fonts/Fredoka/static/Fredoka-Bold.ttf'),

  'LeagueSpartan-Regular':     require('../../assets/fonts/League_Spartan/static/LeagueSpartan-Regular.ttf'),
  'LeagueSpartan-Medium':      require('../../assets/fonts/League_Spartan/static/LeagueSpartan-Medium.ttf'),
  'LeagueSpartan-SemiBold':    require('../../assets/fonts/League_Spartan/static/LeagueSpartan-SemiBold.ttf'),
  'LeagueSpartan-Bold':        require('../../assets/fonts/League_Spartan/static/LeagueSpartan-Bold.ttf'),
  'LeagueSpartan-ExtraBold':   require('../../assets/fonts/League_Spartan/static/LeagueSpartan-ExtraBold.ttf'),
  'LeagueSpartan-Black':       require('../../assets/fonts/League_Spartan/static/LeagueSpartan-Black.ttf'),

  'Eurostile-ExtdBlackItalic': require('../../assets/fonts/Eurostile/Eurostile_Extd_Black_Italic.otf'),
} as const

export const FONTS = {
  aboreto: {
    regular: 'Aboreto-Regular',
  },
  alegreya: {
    regular:      'AlegreyaSC-Regular',
    italic:       'AlegreyaSC-Italic',
    medium:       'AlegreyaSC-Medium',
    mediumItalic: 'AlegreyaSC-MediumItalic',
    bold:         'AlegreyaSC-Bold',
    boldItalic:   'AlegreyaSC-BoldItalic',
    extraBold:    'AlegreyaSC-ExtraBold',
    black:        'AlegreyaSC-Black',
  },
  fredoka: {
    light:    'Fredoka-Light',
    regular:  'Fredoka-Regular',
    medium:   'Fredoka-Medium',
    semiBold: 'Fredoka-SemiBold',
    bold:     'Fredoka-Bold',
  },
  spartan: {
    regular:   'LeagueSpartan-Regular',
    medium:    'LeagueSpartan-Medium',
    semiBold:  'LeagueSpartan-SemiBold',
    bold:      'LeagueSpartan-Bold',
    extraBold: 'LeagueSpartan-ExtraBold',
    black:     'LeagueSpartan-Black',
  },
  eurostile: {
    blackItalic: 'Eurostile-ExtdBlackItalic',
  },
} as const