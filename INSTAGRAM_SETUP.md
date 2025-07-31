# Instagram Section Setup

## Overview
The Instagram section has been added to the hope screen (main homepage) to display Instagram posts in a beautiful grid layout. The section is fully configurable and includes fallback options when the Instagram API is not available.

## Configuration

### 1. Basic Settings
Edit `_data/settings.yml` to configure the Instagram section:

```yaml
#-------------------------------
# Instagram Settings
instagram:
  enabled: true                    # Enable/disable the Instagram section
  account: "bina.lir.cakes.embroidery"  # Instagram account username
  posts_count: 6                   # Number of posts to display
  title: "עקבו אחריי באינסטגרם"    # Section title
  description: "השראה, רקמות ועוד הרבה דברים יפים"  # Section description
```

### 2. Customization Options

#### Change Instagram Account
To change the Instagram account, update the `account` field:
```yaml
instagram:
  account: "your-instagram-username"
```

#### Adjust Number of Posts
To show more or fewer posts:
```yaml
instagram:
  posts_count: 8  # Change to desired number
```

#### Customize Text
To change the Hebrew text:
```yaml
instagram:
  title: "Your Custom Title"
  description: "Your custom description"
```

## Features

### 1. Responsive Design
- Grid layout that adapts to different screen sizes
- Mobile-optimized with smaller images on mobile devices
- Hover effects with Instagram icon overlay

### 2. Fallback System
- When Instagram API is not available, shows sample posts using existing gallery images
- Graceful degradation with loading spinner
- Direct link to Instagram profile

### 3. Performance
- Lazy loading for images
- Optimized CSS animations
- Minimal JavaScript footprint

## Technical Implementation

### Files Created/Modified:
1. `_data/settings.yml` - Added Instagram configuration
2. `_includes/section-instagram.html` - Instagram section template
3. `js/instagram-feed.js` - JavaScript for Instagram feed functionality
4. `_layouts/default.html` - Added script loading
5. `index.html` - Added Instagram section include

### Future Enhancements:
To implement real Instagram API integration:

1. **Instagram Basic Display API**:
   - Register your app with Facebook Developer Console
   - Get access token for Instagram Basic Display API
   - Update `instagram-feed.js` to fetch real posts

2. **Alternative: Instagram Embed**:
   - Use Instagram's embed feature
   - Add iframe with Instagram embed URL
   - Customize embed styling

3. **Server-side Proxy**:
   - Create a server endpoint to fetch Instagram posts
   - Cache responses to avoid rate limits
   - Update frontend to call your proxy endpoint

## Troubleshooting

### Section Not Showing
- Check that `enabled: true` in settings
- Verify the section is included in `index.html`
- Check browser console for JavaScript errors

### Images Not Loading
- Verify image paths in `instagram-feed.js`
- Check that gallery images exist in `/images/gallery/`
- Ensure proper file permissions

### Configuration Not Working
- Clear browser cache
- Restart Jekyll server
- Check YAML syntax in settings file

## Styling Customization

The Instagram section uses CSS classes that can be customized:

- `.instagram-feed` - Main container
- `.instagram-grid` - Grid layout
- `.instagram-post` - Individual post styling
- `.instagram-post-overlay` - Hover overlay
- `.instagram-footer` - Footer button area

Add custom CSS to `_sass/3-modules/_instagram.scss` or modify the inline styles in `section-instagram.html`. 