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

  'AlegreyaSans-Regular':      require('../../assets/fonts/Alegreya_Sans/AlegreyaSans-Regular.ttf'),
  'AlegreyaSans-Italic':       require('../../assets/fonts/Alegreya_Sans/AlegreyaSans-Italic.ttf'),
  'AlegreyaSans-Medium':       require('../../assets/fonts/Alegreya_Sans/AlegreyaSans-Medium.ttf'),
  'AlegreyaSans-MediumItalic': require('../../assets/fonts/Alegreya_Sans/AlegreyaSans-MediumItalic.ttf'),
  'AlegreyaSans-Bold':         require('../../assets/fonts/Alegreya_Sans/AlegreyaSans-Bold.ttf'),
  'AlegreyaSans-BoldItalic':   require('../../assets/fonts/Alegreya_Sans/AlegreyaSans-BoldItalic.ttf'),
  'AlegreyaSans-ExtraBold':    require('../../assets/fonts/Alegreya_Sans/AlegreyaSans-ExtraBold.ttf'),
  'AlegreyaSans-Black':        require('../../assets/fonts/Alegreya_Sans/AlegreyaSans-Black.ttf'),

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
  // Regular (not small caps) Alegreya Sans: messaging only. Everything else
  // keeps its own face.
  alegreyaSans: {
    regular:      'AlegreyaSans-Regular',
    italic:       'AlegreyaSans-Italic',
    medium:       'AlegreyaSans-Medium',
    mediumItalic: 'AlegreyaSans-MediumItalic',
    bold:         'AlegreyaSans-Bold',
    boldItalic:   'AlegreyaSans-BoldItalic',
    extraBold:    'AlegreyaSans-ExtraBold',
    black:        'AlegreyaSans-Black',
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