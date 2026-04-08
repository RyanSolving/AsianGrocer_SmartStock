-- One-time data correction for legacy catalog typo: Avocada -> Avocado
update catalog_entries
set
  product = regexp_replace(product, 'avocada', 'avocado', 'gi'),
  attribute = regexp_replace(attribute, 'avocada', 'avocado', 'gi'),
  official_name = regexp_replace(official_name, 'avocada', 'avocado', 'gi'),
  stocklist_name = regexp_replace(stocklist_name, 'avocada', 'avocado', 'gi')
where
  product ilike '%avocada%'
  or attribute ilike '%avocada%'
  or official_name ilike '%avocada%'
  or stocklist_name ilike '%avocada%';
