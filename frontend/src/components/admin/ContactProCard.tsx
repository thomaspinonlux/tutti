/**
 * <ContactProCard /> — feat/contact-pro (back-office)
 *
 * Thomas : quand un pro se crée un compte, mettre en avant la prise de
 * contact et une zone pour nous écrire.
 */
import { useState } from 'react';
import { Button, Card } from '../ui/index.js';
import { ContactProForm } from '../ContactProForm.js';
import { useEstablishment } from '../../pages/admin/AdminLayout.js';

export function ContactProCard(): JSX.Element | null {
  const { me } = useEstablishment();
  const [ouvert, setOuvert] = useState(false);
  // Le propriétaire n'a pas à s'écrire à lui-même.
  if (me && (me.role === 'OWNER' || me.isSuperAdmin)) return null;
  return (
    <Card size="lg" className="mb-6">
      <p className="font-display text-2xl mb-2">Vous êtes un professionnel ?</p>
      <p className="text-base text-white/85 mb-4">
        Bar, restaurant, société d’événementiel ou entreprise : pour utiliser Tutti régulièrement
        dans vos établissements ou pour vos clients, écrivez-nous. Nous préparons avec vous une
        formule adaptée.
      </p>
      {ouvert ? (
        <ContactProForm variant="app" source="compte" emailParDefaut={me?.user.email ?? ''} />
      ) : (
        <Button size="lg" onClick={() => setOuvert(true)}>
          ✉️ Nous écrire
        </Button>
      )}
    </Card>
  );
}
