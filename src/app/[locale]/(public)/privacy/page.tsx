import type { Metadata } from "next";

type PageParams = { locale: string };

export const metadata: Metadata = {
  robots: { index: true, follow: true },
};

export default async function PrivacyPage({
  params,
}: {
  params: Promise<PageParams>;
}) {
  const { locale } = await params;
  const isArabic = locale === "ar";

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:py-16">
      <article className="space-y-6 leading-relaxed">
        <h1 className="font-heading text-3xl font-medium tracking-tight sm:text-4xl">
          {isArabic ? "سياسة الخصوصية" : "Politique de confidentialité"}
        </h1>

        <p>
          {isArabic
            ? "توضح هذه الصفحة كيف تعالج منصة دويني البيانات اللازمة للبحث عن طبيب وحجز موعد وإدارته. لن تُفتح خدمة الحجز للمرضى الحقيقيين قبل استكمال الإجراءات التنظيمية المطلوبة."
            : "Cette page explique comment Dewini traite les données nécessaires à la recherche d’un médecin, à la réservation d’un rendez-vous et à sa gestion. La réservation ne sera pas ouverte aux patients réels avant l’accomplissement des formalités réglementaires requises."}
        </p>

        <h2 className="font-heading text-2xl font-medium">
          {isArabic ? "البيانات التي نعالجها" : "Données traitées"}
        </h2>
        <p>
          {isArabic
            ? "عند الحجز، نعالج الاسم ورقم الهاتف والبريد الإلكتروني والطبيب والعيادة ونوع الاستشارة وتاريخ ووقت الموعد، إضافة إلى البيانات التقنية اللازمة لتأمين الخدمة."
            : "Lors d’une réservation, nous traitons notamment le nom, le numéro de téléphone, l’adresse e-mail, le médecin, le cabinet, le type de consultation, la date et l’heure du rendez-vous, ainsi que les données techniques nécessaires à la sécurisation du service."}
        </p>

        <h2 className="font-heading text-2xl font-medium">
          {isArabic ? "لماذا نستخدم هذه البيانات" : "Finalités"}
        </h2>
        <p>
          {isArabic
            ? "تستخدم هذه البيانات لإنشاء الموعد وإدارته، إرسال رسائل التأكيد والتعديل والإلغاء، تمكين الطبيب أو سكرتاريته المخول لها من إدارة جدول المواعيد، وحماية المنصة من الاستخدام غير المصرح به."
            : "Ces données sont utilisées pour créer et gérer le rendez-vous, envoyer les confirmations et notifications de modification ou d’annulation, permettre au médecin ou à son secrétariat autorisé de gérer l’agenda et protéger la plateforme contre les accès non autorisés."}
        </p>

        <h2 className="font-heading text-2xl font-medium">
          {isArabic ? "طبيعة الإجابة والجهات التي يمكنها الوصول" : "Caractère obligatoire et destinataires"}
        </h2>
        <p>
          {isArabic
            ? "الاسم ورقم الهاتف والبريد الإلكتروني واختيار الموعد ضرورية لإتمام الحجز؛ عدم تقديمها يمنع إنشاء الموعد. يمكن للطبيب المعني والسكرتارية المخول لها ومزودي الخدمات التقنية الضروريين لتشغيل المنصة الوصول إلى البيانات في حدود مهامهم."
            : "Le nom, le téléphone, l’adresse e-mail et les informations du rendez-vous sont nécessaires pour effectuer la réservation ; en leur absence, le rendez-vous ne peut pas être créé. Le médecin concerné, son secrétariat autorisé et les prestataires techniques nécessaires au fonctionnement du service peuvent accéder aux données dans la limite de leurs missions."}
        </p>

        <h2 className="font-heading text-2xl font-medium">
          {isArabic ? "الاستضافة ونقل البيانات" : "Hébergement et transferts"}
        </h2>
        <p>
          {isArabic
            ? "تستخدم دويني مزودي خدمات تقنيين، وقد تتم استضافة أو معالجة بعض البيانات خارج تونس. لن تُفتح خدمة الحجز للمرضى الحقيقيين قبل استكمال الإجراءات والتراخيص المطلوبة لدى الهيئة الوطنية لحماية المعطيات الشخصية."
            : "Dewini utilise des prestataires techniques et certaines données peuvent être hébergées ou traitées hors de Tunisie. La réservation ne sera pas ouverte aux patients réels avant l’accomplissement des déclarations et autorisations requises auprès de l’Instance nationale de protection des données personnelles."}
        </p>

        <h2 className="font-heading text-2xl font-medium">
          {isArabic ? "الوصول إلى البيانات وحمايتها" : "Accès et sécurité"}
        </h2>
        <p>
          {isArabic
            ? "تقتصر صلاحية الوصول إلى بيانات المواعيد على الأشخاص المخولين تقنياً أو مهنياً. تُستخدم ضوابط وصول على مستوى قاعدة البيانات وروابط إدارة شخصية ومحدودة الصلاحية لحماية المواعيد."
            : "L’accès aux données de rendez-vous est limité aux personnes techniquement ou professionnellement autorisées. Dewini utilise notamment des contrôles d’accès au niveau de la base de données et des liens personnels à durée limitée pour la gestion des rendez-vous."}
        </p>

        <h2 className="font-heading text-2xl font-medium">
          {isArabic ? "مدة الاحتفاظ والحقوق" : "Conservation et droits"}
        </h2>
        <p>
          {isArabic
            ? "سيتم تحديد مدة الاحتفاظ النهائية ضمن إجراءات الامتثال قبل الإطلاق. يمكن سحب الموافقة بالنسبة للمعالجات التي تعتمد عليها وممارسة الحقوق التي يضمنها القانون عبر contact@dewini.net."
            : "La durée de conservation définitive sera formalisée dans le cadre de la mise en conformité avant lancement. Vous pouvez retirer votre consentement pour les traitements qui en dépendent et exercer les droits prévus par la loi en écrivant à contact@dewini.net."}
        </p>

        <p className="text-muted-foreground text-sm">
          {isArabic
            ? "آخر تحديث: 19 أوت 2026 — نسخة ما قبل الإطلاق."
            : "Dernière mise à jour : 19 août 2026 — version pré-lancement."}
        </p>
      </article>
    </div>
  );
}
