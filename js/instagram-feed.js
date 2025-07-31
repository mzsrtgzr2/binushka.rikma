// Instagram Feed Integration
class InstagramFeed {
  constructor(config) {
    this.config = config;
    this.container = document.querySelector('.instagram-grid');
    this.init();
  }

  async init() {
    try {
      // Try to load Instagram posts via API
      await this.loadInstagramPosts();
    } catch (error) {
      console.log('Instagram API not available, showing fallback');
      this.showFallback();
    }
  }

  async loadInstagramPosts() {
    // This would use Instagram Basic Display API
    // For now, we'll show a placeholder with sample posts
    const posts = this.getSamplePosts();
    this.renderPosts(posts);
  }

  getSamplePosts() {
    // Sample posts structure - in real implementation, this would come from Instagram API
    // Using actual gallery images from the site
    return [
      {
        id: 1,
        image: '/images/gallery/00F9DC82-88DA-4F90-9550-8346C2B34E3C_1_105_c.jpeg',
        link: `https://www.instagram.com/${this.config.account}`,
        caption: 'רקמה יפה'
      },
      {
        id: 2,
        image: '/images/gallery/D3652FA1-1446-44BB-AAC6-B9EA7F2928AC_1_105_c.jpeg',
        link: `https://www.instagram.com/${this.config.account}`,
        caption: 'יצירה חדשה'
      },
      {
        id: 3,
        image: '/images/gallery/02F00B26-5222-414E-86CD-BC30DCA965F4_4_5005_c.jpeg',
        link: `https://www.instagram.com/${this.config.account}`,
        caption: 'סדנה מוצלחת'
      },
      {
        id: 4,
        image: '/images/gallery/06E1A3AF-8512-4EC2-B8C2-8B0926B17260_1_105_c.jpeg',
        link: `https://www.instagram.com/${this.config.account}`,
        caption: 'תוצאות מדהימות'
      },
      {
        id: 5,
        image: '/images/gallery/1B31F69D-507E-4114-817F-56622D998AFC_1_105_c.jpeg',
        link: `https://www.instagram.com/${this.config.account}`,
        caption: 'פרטים קטנים'
      },
      {
        id: 6,
        image: '/images/gallery/7AD14191-5528-4E30-8815-A5006C849138_1_105_c.jpeg',
        link: `https://www.instagram.com/${this.config.account}`,
        caption: 'צבעים יפים'
      }
    ];
  }

  renderPosts(posts) {
    if (!this.container) return;

    this.container.innerHTML = '';
    
    posts.slice(0, this.config.postsCount).forEach(post => {
      const postElement = this.createPostElement(post);
      this.container.appendChild(postElement);
    });
  }

  createPostElement(post) {
    const postDiv = document.createElement('div');
    postDiv.className = 'instagram-post';
    
    postDiv.innerHTML = `
      <a href="${post.link}" target="_blank" rel="noopener" aria-label="צפה בתמונה ${post.caption} באינסטגרם">
        <img src="${post.image}" alt="${post.caption}" loading="lazy">
        <div class="instagram-post-overlay">
          <div class="instagram-icon" aria-hidden="true">📸</div>
        </div>
      </a>
    `;
    
    return postDiv;
  }

  showFallback() {
    if (!this.container) return;

    this.container.innerHTML = `
      <div class="instagram-placeholder" style="grid-column: 1 / -1; text-align: center; padding: 2rem;">
        <div style="font-size: 3rem; margin-bottom: 1rem;">📸</div>
        <h4>עקבו אחריי באינסטגרם</h4>
        <p>הציצו בתמונות האחרונות שלי</p>
        <a href="https://www.instagram.com/${this.config.account}" 
           target="_blank" 
           style="display: inline-block; margin-top: 1rem; padding: 0.5rem 1rem; background: #007bff; color: white; text-decoration: none; border-radius: 4px;">
          לראות תמונות
        </a>
      </div>
    `;
  }
}

// Initialize Instagram Feed when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
  // Get Instagram config from data attributes or use defaults
  const instagramConfig = {
    account: document.querySelector('[data-instagram-account]')?.dataset.instagramAccount || 'bina.lir.cakes.embroidery',
    postsCount: parseInt(document.querySelector('[data-instagram-posts]')?.dataset.instagramPosts || '6')
  };
  
  if (document.querySelector('.instagram-grid')) {
    new InstagramFeed(instagramConfig);
  }
}); 