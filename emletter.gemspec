Gem::Specification.new do |spec|
  spec.name = "EmLetter"
  spec.version = "2.1.0"
  spec.authors = ["dylanmeca"]
  spec.summary = "Tema de EmLetter"
  spec.files = Dir["assets/**/*", "_layouts/**/*", "_includes/**/*", "README.md"]
  spec.add_runtime_dependency "jekyll", ">= 3.9", "< 5.0"
  spec.add_runtime_dependency "jekyll-seo-tag", ">= 2.8", "< 3.0"
  spec.add_runtime_dependency "jekyll-sitemap", ">= 1.4", "< 2.0"
end
