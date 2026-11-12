import 'package:flutter/material.dart';

class Product {
  const Product(
    this.id,
    this.name,
    this.subtitle,
    this.priceCents,
    this.icon,
    this.color,
    this.description,
  );
  final String id, name, subtitle, description;
  final int priceCents;
  final IconData icon;
  final Color color;
}

const products = [
  Product(
    'cup',
    'Travel cup',
    'Warm drinks, on the go',
    6900,
    Icons.coffee_outlined,
    Color(0xFFE6EADD),
    'A lightweight 380 ml cup with a food-safe stainless steel lining. Made for tea on your commute or a walk.',
  ),
  Product(
    'bag',
    'Canvas tote',
    'Room for the essentials',
    12900,
    Icons.shopping_bag_outlined,
    Color(0xFFECE2D5),
    'Sturdy cotton canvas with an inside pocket for small essentials. Soft straps and room for your books.',
  ),
  Product(
    'lamp',
    'Desk lamp',
    'A warm pool of light',
    19900,
    Icons.light_outlined,
    Color(0xFFF2E5D2),
    'Three warm light settings with touch controls. A compact lamp for your desk or bedside table.',
  ),
  Product(
    'notebook',
    'Grid notebook',
    'A page for every idea',
    3900,
    Icons.menu_book_outlined,
    Color(0xFFDDE7E8),
    'An A5 notebook with grid pages and a lay-flat binding. Space for notes, sketches, and plans.',
  ),
  Product(
    'speaker',
    'Desk speaker',
    'Good sound, small footprint',
    25900,
    Icons.speaker_outlined,
    Color(0xFFE3DFE9),
    'A compact wireless speaker with a warm sound. Fits on a shelf or beside your work.',
  ),
  Product(
    'blanket',
    'Knit blanket',
    'A softer place to settle',
    15900,
    Icons.checkroom_outlined,
    Color(0xFFE8DED8),
    'A soft knit blanket for an afternoon nap or an evening with a book.',
  ),
];

Product? findProduct(String id) {
  for (final product in products) {
    if (product.id == id) return product;
  }
  return null;
}

String money(int cents) => '¥${(cents / 100).toStringAsFixed(2)}';
