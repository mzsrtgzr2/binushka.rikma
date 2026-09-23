# Drops the public newsletter pages from the sitemap when the feature flag is off.
#
# jekyll-sitemap reads `sitemap: false` while it is generating, which is before
# pages render, so the flag has to be applied at post_read.
module NewsletterVisibility
  module_function

  def hidden?(site)
    newsletter = site.data.dig('settings', 'newsletter') || {}
    newsletter['enabled'] == false
  end

  def public_page?(item)
    label = item.respond_to?(:collection) ? item.collection&.label : nil
    return true if label == 'newsletter'

    # The public page lives in the `pages` collection, so it is not a site.page.
    # Match the file as well as the url: the url is not always assigned yet.
    path = item.respond_to?(:relative_path) ? item.relative_path.to_s : ''
    return true if path == '_pages/newsletter.html'

    url = item.respond_to?(:url) ? item.url.to_s : ''
    ['/newsletter', '/newsletter/', '/newsletter/index.html', '/newsletter.html'].include?(url)
  end
end

Jekyll::Hooks.register :site, :post_read do |site|
  next unless NewsletterVisibility.hidden?(site)

  items = site.pages.dup
  site.collections.each_value { |collection| items.concat(collection.docs) }

  items.each do |item|
    next unless NewsletterVisibility.public_page?(item)

    item.data['sitemap'] = false
    item.data['noindex'] = true
  end
end
