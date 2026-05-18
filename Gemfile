source "https://rubygems.org"

# Match the Jekyll version GitHub Pages bundles. `github-pages` pins the
# whole stack (jekyll + safe plugins + Ruby gems) to whatever Pages ships;
# alternative is plain `jekyll` for newer features at the cost of a small
# divergence from the deployed environment.
gem "jekyll", "~> 4.3"
gem "jekyll-relative-links"

# Local-preview only — `bundle exec jekyll serve` watches files and reloads.
group :jekyll_plugins do
  gem "webrick" # required by jekyll serve on Ruby 3+
end
